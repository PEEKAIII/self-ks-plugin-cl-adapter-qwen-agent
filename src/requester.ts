import { ChatGenerationChunk } from '@langchain/core/outputs'
import { AIMessageChunk } from '@langchain/core/messages'
import { Context } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'

export class QWenRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    private _sessionCache: Map<string, { sessionId: string; lastAccess: number }> = new Map()

    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    private _getSessionKey(messages: { content?: string | unknown[] }[]): string {
        const firstMsg = messages[0]
        if (!firstMsg) return 'default'
        const content = typeof firstMsg.content === 'string' 
            ? firstMsg.content 
            : JSON.stringify(firstMsg.content)
        return content.slice(0, 64)
    }

    private _getSessionId(key: string): string | undefined {
        const cached = this._sessionCache.get(key)
        if (!cached) return undefined
        const cacheTime = this._pluginConfig.threadCacheTime * 1000
        if (Date.now() - cached.lastAccess > cacheTime) {
            this._sessionCache.delete(key)
            return undefined
        }
        return cached.sessionId
    }

    private _setSessionId(key: string, sessionId: string): void {
        this._sessionCache.set(key, { sessionId, lastAccess: Date.now() })
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        // Check if the model is aliyun-agent-2.0 and use the dedicated method
        if (params.model === 'aliyun-agent-2.0') {
            yield* this._completionStreamAgent20(params)
            return
        }

        // Original Qwen logic
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        let model = params.model
        let enabledThinking: boolean | undefined

        if (model.includes('thinking')) {
            enabledThinking = !model.includes('-non-thinking')
            model = model.replace('-non-thinking', '').replace('-thinking', '')
        } else if (model.includes('default')) {
            enabledThinking = true
            model = model.replace('-default', '-thinking')
        }

        const baseRequest = (await buildChatCompletionParams(
            {
                ...params,
                model,
                tools: model.includes('vl') ? undefined : params.tools
            },
            this._plugin,
            false,
            false
        )) as Awaited<ReturnType<typeof buildChatCompletionParams>> & {
            enabled_thinking?: boolean
            enable_search?: boolean
            parallel_tool_calls?: boolean
        }

        if (enabledThinking != null) {
            baseRequest.enabled_thinking = enabledThinking
        }

        baseRequest.parallel_tool_calls = true

        if (!model.includes('vl')) {
            baseRequest.enable_search = this._pluginConfig.enableSearch
        }

        try {
            const response = await this.post('chat/completions', baseRequest, {
                signal: params.signal
            })

            const iterator = sseIterable(response)
            const streamChunks = processStreamResponse(requestContext, iterator)

            for await (const chunk of streamChunks) {
                yield chunk
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    // Private method for aliyun-agent-2.0 model
    private async *_completionStreamAgent20(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        try {
            const baseRequest = await buildChatCompletionParams(params, this._plugin, false, false)
            const agentId = this._pluginConfig.agentId

            const sessionKey = this._getSessionKey(baseRequest.messages)
            let sessionId = this._getSessionId(sessionKey)

            // ========== 问题3修复: messages → prompt 转换 ==========
            // 官方 API 要求传入 prompt 字符串，但 chatluna 传递的是 messages 数组
            // 需要提取最后一条消息的内容作为 prompt
            const lastMessage = baseRequest.messages[baseRequest.messages.length - 1]
            const prompt = typeof lastMessage.content === 'string'
                ? lastMessage.content
                : lastMessage.content.map((c: { text?: string }) => c.text || '').join('')
            // =====================================================

            const agentRequest = {
                input: {
                    prompt,
                    session_id: sessionId
                },
                parameters: {
                    incremental_output: true
                },
                debug: {}
            }

            // Agent 2.0 API 使用不同的 base URL
            // 临时修改 concatUrl 返回正确的 base URL
            const originalConcatUrl = this.concatUrl.bind(this)
            this.concatUrl = (url: string) => `https://dashscope.aliyuncs.com/api/v1/apps/${agentId}/${url}`

            const apiKey = this._pluginConfig.apiKeys
                .filter(([key, enabled]) => key.length > 0 && enabled)
                .map(([key]) => key)[0] || ''

            try {
                const response = await this.post('completion', agentRequest, {
                    signal: params.signal,
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'X-DashScope-SSE': 'enable'
                    }
                })

                // 恢复原始 concatUrl
                this.concatUrl = originalConcatUrl

                // Agent 2.0：将阿里云格式转换为 OpenAI 格式，然后复用 processStreamResponse
                const rawIterator = sseIterable(response)

                // 创建转换后的迭代器：阿里云格式 → OpenAI 格式
                async function* convertIterator() {
                    for await (const event of rawIterator) {
                        // 跳过非数据事件
                        if (!event.data) continue

                        try {
                            const parsed = JSON.parse(event.data)

                            // 处理错误响应
                            if (parsed.code && parsed.code !== '') {
                                throw new Error(`${parsed.code}: ${parsed.message}`)
                            }

                            // 转换为 OpenAI 格式
                            if (parsed.output) {
                                // 提取 session_id
                                if (parsed.output.session_id && !sessionId) {
                                    sessionId = parsed.output.session_id
                                    this._setSessionId(sessionKey, sessionId)
                                }

                                // 转换为 OpenAI SSE 格式
                                const openAIEvent = {
                                    data: JSON.stringify({
                                        id: parsed.request_id || `chatcmpl-${Date.now()}`,
                                        object: 'chat.completion.chunk',
                                        created: Math.floor(Date.now() / 1000),
                                        model: 'aliyun-agent-2.0',
                                        choices: [{
                                            index: 0,
                                            delta: {
                                                content: parsed.output.text || '',
                                                role: 'assistant'
                                            },
                                            finish_reason: parsed.output.finish_reason === 'stop' ? 'stop' : null
                                        }]
                                    })
                                }
                                yield openAIEvent

                                // 检查是否结束
                                if (parsed.output.finish_reason === 'stop') {
                                    break
                                }
                            }
                        } catch (e) {
                            if (e instanceof SyntaxError) {
                                this.ctx.logger('chatluna-qwen-agent').warn(`Failed to parse SSE data: ${event.data}`)
                                continue
                            }
                            throw e
                        }
                    }
                }

                // 使用 bind 确保 this 指向正确
                const boundConvertIterator = convertIterator.bind(this)

                // 复用 processStreamResponse 处理转换后的 OpenAI 格式
                const streamChunks = processStreamResponse(requestContext, boundConvertIterator())

                for await (const chunk of streamChunks) {
                    yield chunk
                }
            } finally {
                // 确保 concatUrl 被恢复
                this.concatUrl = originalConcatUrl
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    concatUrl(url: string): string {
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1/' + url
    }

    get logger() {
        return this.ctx.logger('chatluna-qwen-adapter')
    }
}
