import { ChatGenerationChunk } from '@langchain/core/outputs'
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
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
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

        let sessionId: string | undefined

        try {
            const baseRequest = await buildChatCompletionParams(params, this._plugin, false, false)
            const agentId = this._pluginConfig.agentId

            const lastMessage = baseRequest.messages[baseRequest.messages.length - 1]
            const prompt = typeof lastMessage.content === 'string'
                ? lastMessage.content
                : lastMessage.content.map((c: { text?: string }) => c.text || '').join('')

            const agentRequest = {
                input: {
                    prompt,
                    session_id: sessionId
                },
                parameters: {},
                debug: {}
            }

            // 2. 拼接正确的请求地址（使用 dashscope 域名）
            const url = `https://dashscope.aliyuncs.com/api/v1/apps/${agentId}/completion`
            // 从 apiKeys 数组中获取第一个启用的 API Key
            const apiKey = this._pluginConfig.apiKeys
                .filter(([key, enabled]) => key.length > 0 && enabled)
                .map(([key]) => key)[0] || ''
            const response = await this.post(url, agentRequest, {
                signal: params.signal,
                headers: { // 显式加鉴权头（如果 post 方法不自动加）
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })

            const iterator = sseIterable(response)
            for await (const event of iterator) {
                if (event.type === 'thread.created') {
                    sessionId = JSON.parse(event.data).threadId
                } else if (event.type === 'message.delta') {
                    const deltaData = JSON.parse(event.data)
                    const delta = deltaData.content || ''
                    const chunk = {
                        choices: [{ delta: { content: delta } }],
                        generationInfo: { sessionId }
                    } as unknown as ChatGenerationChunk
                    yield chunk
                }
                else if (event.type === 'run.failed') {
                    const errorData = JSON.parse(event.data)
                    throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, errorData.message)
                }
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
