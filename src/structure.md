### 一、核心修改内容汇总（按文件分类，低侵入原则贯穿全程）
#### 1. `client.ts`（QWenClient 类）
- 新增 `aliyun-agent-2.0` 模型到 `refreshModels()` 方法的模型列表中；
- 在 `_createModel()` 方法前置判断模型名，匹配 `aliyun-agent-2.0` 时返回自定义 `ChatLunaChatModel` 实例（仅修改 `llmType` 和 `isThinkModel`，其余字段复用原有结构）；
- 全程未改动原有 Qwen 模型逻辑，仅做“追加式”伪装适配。

#### 2. `requester.ts`（QWenRequester 类）
- 在 `completionStreamInternal` 方法开头新增模型判断分支，匹配 `aliyun-agent-2.0` 时调用专属方法；
- 新增私有方法 `_completionStreamAgent20`：
  - 从配置读取 `agentId`（新版 APP ID）、`apiKey`（从 `apiKeys` 数组取首个启用值）；
  - 适配新版 AI 应用接口地址：`POST https://dashscope.aliyuncs.com/api/v1/apps/{agentId}/completion`；
  - 构造符合官方规范的请求体（`appId`/`messages`/`stream`），补充鉴权头 `Authorization: Bearer {apiKey}`；
  - 解析 Agent 2.0 的 SSE 事件（`thread.created`/`message.delta`/`run.failed`/`run.completed`），输出格式对齐原有 Qwen 的 `ChatGenerationChunk`；
- 保留原有 Qwen 所有请求逻辑、嵌入模型方法 `embeddings()` 完全未动。

#### 3. `index.ts`（插件入口/配置定义）
- 在 `Config` 接口和 Schema 中追加 Agent 2.0 专属配置项：`agentId`（新版 APP ID）、`workspaceId`（旧版兼容）、`agentApiEndpoint`（自定义接口地址）、`threadCacheTime`（Thread 缓存时长）；
- 统一配置字段大小写（`apiKey` 驼峰），修复 `Schema.intersect` 拆分导致的配置隔离问题；
- 保留原有 `apiKeys` 数组、`temperature`、`enableSearch` 等所有 Qwen 配置，仅做字段追加。

#### 4. `locales/zh-CN.schema.yml` / `en-US.schema.yml`（可选）
- 追加 Agent 2.0 配置项的国际化翻译，标注 `workspaceId` 为旧版无需填写，提升控制台使用体验；
- 保留原有所有翻译内容，仅末尾追加新字段翻译。

#### 5. 无需修改的文件
- `types.ts`：复用原有 Qwen 接口定义，Agent 2.0 输出格式对齐后无需改动；
- `utils.ts`：格式转换逻辑通用，Agent 2.0 复用 Qwen 消息/工具格式，无需改动。

### 二、核心达成目的（低侵入 + 伪装适配）
#### 1. 功能层面
- ✅ 新增阿里云新版 AI 应用（Agent 2.0）适配，支持 `aliyun-agent-2.0` 模型调用；
- ✅ Agent 2.0 完全伪装成 Qwen 原生模型，上层 ChatLuna/用户无感知，无需修改前端/其他插件；
- ✅ 兼容原有所有 Qwen 模型功能（普通对话、工具调用、图像输入、嵌入模型），改完不影响旧功能使用；
- ✅ 支持新版 AI 应用接口 `https://dashscope.aliyuncs.com/api/v1/apps/APP_ID/completion`，鉴权、流式响应完全符合官方规范。

#### 2. 工程层面
- ✅ 严格遵循“低侵入”原则：所有修改均为“追加/分支判断”，未删除/改动原有任意一行 Qwen 核心代码；
- ✅ 配置可配置化：Agent 2.0 关键参数（`agentId`/`apiKey`）支持控制台输入，无需硬编码；
- ✅ 错误处理统一：Agent 2.0 异常包装为 `ChatLunaError`，和原有错误逻辑一致，便于问题排查；
- ✅ 兼容性强：`workspaceId` 保留旧版兼容，`agentApiEndpoint` 支持自定义接口地址，适配不同环境。

### 三、后续修改关键参考点
1. **新增 Agent 2.0 特性**：如需支持工具调用、Thread 缓存复用，仅需在 `_completionStreamAgent20` 中扩展，不碰原有逻辑；
2. **接口地址调整**：修改 `agentApiEndpoint` 配置或 `_completionStreamAgent20` 中的 `baseUrl` 即可，无需全局改动；
3. **配置扩展**：新增 Agent 2.0 专属参数（如 `top_p`），仅需在 `index.ts` 追加配置字段，在 `_completionStreamAgent20` 中读取即可；
4. **问题排查**：优先检查 `agentId`（新版 APP ID）、`apiKey` 是否正确，请求地址是否拼接 `agentId`，SSE 事件解析是否覆盖 `run.failed`；
5. **版本兼容**：若后续切换回旧版 Agent 接口，仅需修改 `_completionStreamAgent20` 中的请求地址和 `workspaceId` 拼接逻辑，其余代码无需动。

核心逻辑链路：控制台配置 `agentId`/`apiKey` → `client.ts` 伪装模型 → `requester.ts` 分支调用 Agent 2.0 接口 → 解析 SSE 并对齐输出格式 → 上层无感知使用。
adapter-qwen-kc/
├── src/
│   ├── index.ts          # 插件主入口，定义配置和初始化逻辑
│   ├── client.ts         # QWenClient 类，管理模型列表和创建
│   ├── requester.ts      # QWenRequester 类，处理 API 请求
│   ├── types.ts          # TypeScript 类型定义
│   ├── utils.ts          # 工具函数（消息格式化等）
│   └── locales/          # 国际化配置
├── tsconfig.json         # TypeScript 配置
├── package.json          # 项目依赖和脚本

client.ts
类 QWenClient 继承自 PlatformModelAndEmbeddingsClient
    平台标识 = 'qwen'
    私有变量 _requester: QWenRequester

    构造函数(上下文 ctx, 配置 _config, 插件 plugin)
        调用父类构造函数(ctx, plugin.platformConfigPool)
        
        创建 QWenRequester 实例并赋值给 _requester
            参数: ctx, plugin.platformConfigPool, _config, plugin

    异步方法 refreshModels() 返回 模型信息列表
        定义原始模型列表 rawModels
            包含模型名称和对应的上下文大小
            例如: ['qwen-turbo', 100000], ['qwen-plus', 131072] 等
            包含大语言模型和嵌入模型

        定义支持推理努力的模型列表 reasoningEffortModels
            例如: 'qwen3.5-plus', 'qwen3.5-plus-2026-02-15'

        定义支持图像输入的模型模式列表 imageInputSupportModels
            例如: 'vl', 'omni', 'vision', 'qvq', 'qwen3.5'

        扩展模型列表 expandedModels
            遍历 rawModels 中的每个模型
                将原始模型加入结果列表
                如果模型在 reasoningEffortModels 中
                    为该模型生成 'non-thinking' 和 'thinking' 变体
                    将变体也加入结果列表

        处理额外配置的模型 additionalModels
            从配置中读取 additionalModels
            将每个额外模型转换为 ModelInfo 对象
                包含: 名称, 类型(嵌入模型或LLM), 能力, 最大token数

        将 expandedModels 转换为 ModelInfo 对象列表
            遍历每个模型
                判断模型类型
                    如果名称包含 'embedding' -> 嵌入模型
                    否则 -> 大语言模型
                
                判断模型能力
                    如果名称包含特定关键词(qwen-plus, qwen-max等) -> 支持工具调用
                    如果名称包含图像支持模式(vl, omni等) -> 支持图像输入
                
                创建 ModelInfo 对象
                    包含: 名称, 类型, 最大token数, 能力列表

        合并转换后的模型列表和额外模型列表
        返回完整的模型信息列表

    保护方法 _createModel(模型名称 model) 返回 模型实例
        从 _modelInfos 中获取模型信息 info
        
        如果 info 为空
            记录警告日志: 模型未找到
            抛出错误: MODEL_NOT_FOUND
        
        如果模型类型是 LLM
            获取模型最大上下文大小 modelMaxContextSize
            
            创建 ChatLunaChatModel 实例
                参数:
                    modelInfo: info
                    requester: _requester
                    model: 模型名称
                    modelMaxContextSize: 最大上下文大小
                    maxTokenLimit: 计算后的最大token限制
                        = floor(最大上下文大小 * 配置的maxContextRatio)
                    timeout: 配置的超时时间
                    temperature: 配置的温度参数
                    maxRetries: 配置的最大重试次数
                    llmType: 'qwen'
                    isThinkModel: 判断是否为思考模型
                        如果名称包含 'reasoner' 或 'r1' 或 'thinking' 或 'qwq'
                            -> 是思考模型
            
            返回 ChatLunaChatModel 实例
        
        否则(嵌入模型)
            创建 ChatLunaEmbeddings 实例
                参数:
                    client: _requester
                    model: 模型名称
                    batchSize: 5
                    maxRetries: 配置的最大重试次数
            
            返回 ChatLunaEmbeddings 实例


# QWen 适配器核心文件分析

## requester.ts 中文伪代码与核心逻辑

### 核心逻辑
`QWenRequester` 类是 Qwen 模型的请求器，负责处理与 Qwen API 的交互，包括聊天完成和嵌入请求。

### 中文伪代码

```类 QWenRequester 继承自 ModelRequester 并实现 EmbeddingsRequester 接口
    构造函数(上下文 ctx, 配置池 _configPool, 插件配置 _pluginConfig, 插件 _plugin)
        调用父类构造函数(ctx, _configPool, _pluginConfig, _plugin)

    异步生成器方法 completionStreamInternal(参数 params)
        创建请求上下文 requestContext
            调用 createRequestContext 函数
            参数: this.ctx, this._config.value, this._pluginConfig, this._plugin, this


        提取模型名称 model
        初始化 enabledThinking 变量

        处理模型名称中的思考模式标记
            如果模型名称包含 'thinking'
                设置 enabledThinking = 模型名称不包含 '-non-thinking'
                从模型名称中移除 '-non-thinking' 或 '-thinking' 后缀
            否则如果模型名称包含 'default'
                设置 enabledThinking = true
                将 '-default' 替换为 '-thinking'

        构建基础请求参数 baseRequest
            调用 buildChatCompletionParams 函数
            参数:
                {
                    ...params,
                    model: 处理后的模型名称,
                    tools: 如果模型包含 'vl' 则为 undefined，否则为 params.tools
                },
                this._plugin,
                false,
                false

        如果 enabledThinking 不为 null
            在 baseRequest 中设置 enabled_thinking = enabledThinking

        设置 baseRequest.parallel_tool_calls = true

        如果模型不包含 'vl'
            设置 baseRequest.enable_search = this._pluginConfig.enableSearch

        尝试执行请求
            发送 POST 请求到 'chat/completions' 端点
            参数: baseRequest, { signal: params.signal }

            将响应转换为 SSE 迭代器
            处理流响应，获取流块
            遍历流块并 yield 每个块
        捕获异常
            如果是 ChatLunaError，直接抛出
            否则，包装为 ChatLunaError 并抛出，错误代码为 API_REQUEST_FAILED

    异步方法 embeddings(参数 params)
        创建请求上下文 requestContext
            调用 createRequestContext 函数
            参数: this.ctx, this._config.value, this._pluginConfig, this._plugin, this

        调用 createEmbeddings 函数
        参数: requestContext, params
        返回结果

    方法 concatUrl(url)
        返回 'https://dashscope.aliyuncs.com/compatible-mode/v1/' + url

    获取器 logger
        返回 this.ctx.logger('chatluna-qwen-adapter')
```

### 关键功能点
1. **流式响应处理**：通过 `completionStreamInternal` 方法处理流式聊天完成请求
2. **思考模式处理**：支持模型的思考模式（thinking/non-thinking）
3. **视觉模型处理**：对包含 'vl' 的视觉模型特殊处理
4. **嵌入请求处理**：通过 `embeddings` 方法处理嵌入请求
5. **错误处理**：统一处理 API 请求错误

## types.ts 中文伪代码与核心逻辑

### 核心逻辑
`types.ts` 文件定义了 Qwen API 的请求和响应类型，为 TypeScript 提供类型安全。

### 中文伪代码

```
// 聊天完成响应接口
接口 ChatCompletionResponse
    choices: 数组
        元素包含:
            index: 数字
            finish_reason: 字符串或 null
            delta:
                content?: 字符串
                role?: 字符串
                reasoning_content?: 字符串
                function_call?: ChatCompletionRequestMessageToolCall
            message: ChatCompletionResponseMessage
    id: 字符串
    object: 字符串
    created: 数字
    model: 字符串
    usage:
        prompt_tokens: 数字
        completion_tokens: 数字
        total_tokens: 数字

// 聊天完成响应消息接口
接口 ChatCompletionResponseMessage
    role: 字符串
    content?:
        字符串 或
        数组，元素为:
            { type: 'text', text: 字符串 } 或
            { type: 'image_url', image_url: { url: 字符串, detail?: 'low' | 'high' } }
    name?: 字符串
    tool_calls?: ChatCompletionRequestMessageToolCall 数组
    tool_call_id?: 字符串

// 聊天完成响应消息角色枚举
类型 ChatCompletionResponseMessageRoleEnum =
    'system' | 'assistant' | 'user' | 'function' | 'tool'

// 聊天完成函数接口
接口 ChatCompletionFunction
    name: 字符串
    description?: 字符串
    parameters?: { [key: string]: any }

// 聊天完成工具接口
接口 ChatCompletionTool
    type: 字符串
    function: ChatCompletionFunction

// 聊天完成请求消息工具调用接口
接口 ChatCompletionRequestMessageToolCall
    id: 字符串
    type: 'function'
    function:
        name: 字符串
        arguments: 字符串

// 创建嵌入响应接口
接口 CreateEmbeddingResponse
    object: 字符串
    model: 字符串
    data: CreateEmbeddingResponseDataInner 数组
    usage: CreateEmbeddingResponseUsage

// 创建嵌入请求接口
接口 CreateEmbeddingRequest
    model: 字符串
    input: 字符串 或 字符串数组

// 创建嵌入响应数据内部接口
接口 CreateEmbeddingResponseDataInner
    index: 数字
    object: 字符串
    embedding: 数字数组

// 创建嵌入响应使用情况接口
接口 CreateEmbeddingResponseUsage
    prompt_tokens: 数字
    total_tokens: 数字
```

### 关键类型定义
1. **聊天完成相关**：定义了聊天完成请求和响应的结构
2. **消息结构**：支持文本和图像内容的消息结构
3. **工具调用**：定义了工具调用的结构
4. **嵌入相关**：定义了嵌入请求和响应的结构

## 整体架构关系

1. **client.ts**：负责模型管理和创建
2. **requester.ts**：负责与 Qwen API 的实际交互
3. **types.ts**：定义 API 交互的数据结构

这三个文件共同构成了 Qwen 适配器的核心功能，实现了从模型管理到 API 调用的完整流程。

## 主要流程

1. **初始化**：创建 `QWenClient` 实例，初始化 `QWenRequester`
2. **模型刷新**：调用 `refreshModels` 获取模型列表
3. **模型创建**：调用 `_createModel` 创建模型实例
4. **请求处理**：通过 `QWenRequester` 发送 API 请求
   - 流式聊天完成：`completionStreamInternal`
   - 嵌入请求：`embeddings`
5. **响应处理**：处理 API 响应，返回结果

这种分层设计使得代码结构清晰，职责分明，便于维护和扩展。


让我查看utils.ts文件的内容，了解其核心逻辑。
        
            
toolName: view_files
            
status: success
          
            
filePath: e:\koishi_dev\kechuang_agent\chatluna-1-dev\chatluna-1-dev\packages\adapter-qwen\src\utils.ts
          
# utils.ts 中文伪代码与核心逻辑

## 核心功能
`utils.ts` 文件提供了消息和工具格式转换的工具函数，主要用于 LangChain 消息格式与 Qwen API 格式之间的转换。

## 中文伪代码

### 1. 工具格式转换

```typescript
函数 formatToolsToQWenTools(tools: 工具数组)
    如果工具数组长度小于 1
        返回 undefined
    
    返回 tools.map(formatToolToQWenTool)
```

```typescript
函数 formatToolToQWenTool(tool: 单个工具)
    处理工具的参数 schema
        调用 removeAdditionalProperties 移除额外属性
        如果是 Zod schema v3
            使用 zodToJsonSchema 转换为 JSON schema
        否则
            直接使用工具的 schema
    
    返回 Qwen 工具格式对象
        {
            type: 'function',
            function: {
                name: 工具名称,
                description: 工具描述,
                parameters: 处理后的参数 schema
            }
        }
```

### 2. 消息格式转换

```typescript
异步函数 langchainMessageToQWenMessage(messages: 消息数组, plugin: 插件, model: 模型名称)
    初始化结果数组 result
    
    遍历每个原始消息 rawMessage
        获取消息角色 role
            调用 messageTypeToQWenRole(rawMessage.getType())
        
        创建基础消息对象 msg
            content: 消息内容或 null
            name: 如果角色是 assistant 或 tool，则为消息名称，否则为 undefined
            role: 消息角色
            tool_call_id: 如果是工具消息，则为工具调用ID
        
        如果消息类型是 'ai' (AI 消息)
            获取工具调用 tool_calls
            如果工具调用数组存在且长度大于 0
                将工具调用转换为 Qwen 格式
                    {
                        id: 工具调用ID,
                        type: 'function',
                        function: {
                            name: 工具名称,
                            arguments: JSON.stringify(工具参数)
                        }
                    }
        
        如果 msg.tool_calls 为 null
            删除 msg.tool_calls 属性
        
        如果 msg.tool_call_id 为 null
            删除 msg.tool_call_id 属性
        
        如果 msg.tool_calls 存在
            遍历每个工具调用
                如果工具调用参数存在
                    格式化参数字符串
                        移除空格、换行符等
                        tool.arguments = JSON.stringify(JSON.parse(tool.arguments))
        
        处理图像内容
            获取消息中的图像列表 images
            
            如果模型支持图像输入且图像列表不为空
                将消息内容转换为数组格式
                    [{ type: 'text', text: 消息内容 }]
                
                并行处理所有图像
                    对每个图像调用 fetchImageUrl 获取图像URL
                    如果成功，返回图像内容对象
                        {
                            type: 'image_url',
                            image_url: { url: 图像URL, detail: 'low' }
                        }
                    如果失败，返回 null
                
                过滤掉 null 值
                将图像内容添加到消息内容中
            
            否则如果消息内容已经是数组且长度大于 0
                遍历消息内容数组
                    如果是图像URL内容
                        调用 fetchImageUrl 获取图像URL
                        如果成功，返回图像内容对象
                        如果失败，返回 null
                
                过滤掉 null 值
                更新消息内容
        
        将处理后的消息添加到结果数组
    
    返回结果数组
```

### 3. 消息类型转换

```typescript
函数 messageTypeToQWenRole(type: 消息类型)
    根据 type 返回对应的 Qwen 角色
        'system' -> 'system'
        'ai' -> 'assistant'
        'human' -> 'user'
        'function' -> 'function'
        'tool' -> 'tool'
        其他 -> 抛出错误 "Unknown message type: {type}"
```

### 4. Delta 转消息块

```typescript
函数 convertDeltaToMessageChunk(delta: delta对象, defaultRole: 默认角色)
    确定角色 role
        如果 delta.role 存在且长度大于 0，使用 delta.role
        否则使用 defaultRole
        转换为小写
    
    提取内容
        content = delta.content 或空字符串
        reasoningContent = delta.reasoning_content 或空字符串
    
    初始化额外参数 additionalKwargs
        如果 reasoningContent 长度大于 0
            添加 reasoning_content 到 additionalKwargs
    
    根据角色创建对应的消息块
        如果 role 是 'user'
            返回 HumanMessageChunk({ content })
        
        否则如果 role 是 'assistant'
            处理工具调用块
                如果 delta.tool_calls 是数组
                    遍历每个原始工具调用
                        提取工具调用信息
                            name: 工具名称
                            args: 工具参数
                            id: 工具调用ID
                            index: 索引
            
            返回 AIMessageChunk({
                content,
                tool_call_chunks: 工具调用块数组,
                additional_kwargs: additionalKwargs
            })
        
        否则如果 role 是 'system'
            返回 SystemMessageChunk({ content })
        
        否则如果 role 是 'function'
            返回 FunctionMessageChunk({
                content,
                additional_kwargs: additionalKwargs,
                name: delta.name
            })
        
        否则如果 role 是 'tool'
            返回 ToolMessageChunk({
                content,
                additional_kwargs: additionalKwargs,
                tool_call_id: delta.tool_call_id
            })
        
        否则
            返回 ChatMessageChunk({ content, role })
```

## 核心逻辑分析

### 1. 工具格式转换
- **目的**：将 LangChain 的 `StructuredTool` 格式转换为 Qwen API 需要的格式
- **关键处理**：
  - 使用 `zodToJsonSchema` 将 Zod schema 转换为 JSON schema
  - 移除额外的属性以符合 API 要求
  - 返回标准的 Qwen 工具格式

### 2. 消息格式转换
- **目的**：将 LangChain 消息格式转换为 Qwen API 消息格式
- **关键处理**：
  - **角色映射**：将 LangChain 消息类型映射到 Qwen 角色
  - **工具调用处理**：转换工具调用格式，格式化参数字符串
  - **图像内容处理**：
    - 检测模型是否支持图像输入
    - 获取图像 URL（通过 `fetchImageUrl`）
    - 构建包含文本和图像的多模态消息
  - **内容格式化**：处理消息内容的数组格式

### 3. 消息类型映射
- **目的**：建立 LangChain 消息类型与 Qwen 角色之间的映射关系
- **映射关系**：
  - `system` → `system`
  - `ai` → `assistant`
  - `human` → `user`
  - `function` → `function`
  - `tool` → `tool`

### 4. Delta 转消息块
- **目的**：将流式响应的 delta 对象转换为 LangChain 消息块
- **关键处理**：
  - **角色确定**：优先使用 delta 中的角色，否则使用默认角色
  - **内容提取**：提取普通内容和推理内容
  - **工具调用处理**：提取并格式化工具调用信息
  - **消息块创建**：根据角色创建对应类型的消息块

## 技术特点

1. **类型安全**：使用 TypeScript 类型定义确保数据结构的正确性
2. **异步处理**：图像 URL 获取使用异步操作，支持并行处理
3. **错误处理**：图像获取失败时返回 null，不影响整体流程
4. **格式化**：工具参数字符串格式化，移除多余空格和换行
5. **多模态支持**：支持文本和图像混合的消息内容

## 依赖关系

- **LangChain 核心**：使用 `@langchain/core` 的消息和工具类型
- **共享适配器**：使用 `@chatluna/v1-shared-adapter` 的通用功能
- **ChatLuna 插件**：使用插件服务和工具函数

## 使用场景

1. **工具调用**：将 LangChain 工具转换为 Qwen API 格式
2. **消息转换**：在发送请求前将 LangChain 消息转换为 Qwen 格式
3. **流式响应处理**：将 Qwen API 的流式响应转换为 LangChain 消息块
4. **多模态支持**：处理包含图像的消息内容


          
# index.ts 中文伪代码与核心逻辑

## 核心功能
`index.ts` 是 Qwen 适配器的入口文件，负责插件的初始化、配置管理和客户端注册。

## 中文伪代码

### 1. 导入和导出

```typescript
导入所需模块
    ChatLunaPlugin: ChatLuna 插件服务
    Context, Logger, Schema: Koishi 核心模块
    QWenClient: Qwen 客户端
    ModelCapabilities: 模型能力类型
    createLogger: 日志创建工具

导出 logger 变量（用于日志记录）
```

### 2. 插件应用函数

```typescript
函数 apply(ctx: 上下文, config: 配置)
    创建日志记录器
        logger = createLogger(ctx, 'chatluna-qwen-adapter')
    
    监听 Koishi 的 'ready' 事件
        ctx.on('ready', async () => {
            创建 ChatLunaPlugin 实例
                plugin = new ChatLunaPlugin(ctx, config, 'qwen')
            
            配置插件解析器
                plugin.parseConfig((config) => {
                    过滤并转换 API 密钥配置
                    返回过滤后的配置数组
                        过滤条件:
                            - API 密钥长度大于 0
                            - API 密钥已启用
                        
                        映射为客户端配置对象
                            {
                                apiKey: API 密钥,
                                apiEndpoint: '',
                                platform: 'qwen',
                                chatLimit: 配置的聊天时间限制,
                                timeout: 配置的超时时间,
                                maxRetries: 配置的最大重试次数,
                                concurrentMaxSize: 配置的并发最大大小
                            }
                })
            
            注册 QWen 客户端
                plugin.registerClient(() => new QWenClient(ctx, config, plugin))
            
            初始化客户端
                await plugin.initClient()
        })
```

### 3. 配置接口定义

```typescript
接口 Config 继承自 ChatLunaPlugin.Config
    apiKeys: [字符串, 布尔值] 数组
        - 字符串: API 密钥
        - 布尔值: 是否启用
    
    enableSearch: 布尔值
        - 是否启用搜索功能
    
    additionalModels: 额外模型数组
        每个元素包含:
            model: 字符串 (模型名称)
            modelType: 字符串 (模型类型)
            contextSize: 数字 (上下文大小)
            modelCapabilities: ModelCapabilities 数组 (模型能力)
    
    maxContextRatio: 数字
        - 最大上下文比例 (0-1)
    
    temperature: 数字
        - 温度参数 (0-2)
```

### 4. 配置 Schema 定义

```typescript
配置 Schema = Schema.intersect([
    ChatLunaPlugin.Config (基础配置),
    
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.boolean().default(true)
            ])
        )
            .default([[]])
            .role('table'),
        
        additionalModels: Schema.array(
            Schema.object({
                model: Schema.string(),
                modelType: Schema.union([
                    'LLM 大语言模型',
                    'Embeddings 嵌入模型'
                ]).default('LLM 大语言模型'),
                modelCapabilities: Schema.array(
                    Schema.union([
                        ModelCapabilities.ToolCall,
                        ModelCapabilities.ImageInput
                    ])
                )
                    .default([ModelCapabilities.ToolCall])
                    .role('checkbox'),
                contextSize: Schema.number().default(128000)
            })
        )
            .default([])
            .role('table')
    }),
    
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        
        temperature: Schema.percent()
            .min(0)
            .max(2)
            .step(0.1)
            .default(1),
        
        enableSearch: Schema.boolean().default(true)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
})
```

### 5. 插件元数据

```typescript
导出 inject = ['chatluna']
    - 声明依赖 chatluna 插件

导出 name = 'chatluna-qwen-adapter'
    - 插件名称
```

## 核心逻辑分析

### 1. 插件初始化流程

```
1. Koishi 加载插件
   ↓
2. 调用 apply(ctx, config)
   ↓
3. 创建日志记录器
   ↓
4. 等待 Koishi ready 事件
   ↓
5. 创建 ChatLunaPlugin 实例
   ↓
6. 配置插件解析器
   ↓
7. 注册 QWenClient
   ↓
8. 初始化客户端
```

### 2. 配置解析逻辑

**API 密钥处理**：
- 从配置中读取 API 密钥数组
- 过滤掉空密钥和未启用的密钥
- 转换为客户端配置对象

**额外模型处理**：
- 支持用户自定义添加模型
- 可以指定模型类型（LLM 或嵌入模型）
- 可以配置模型能力（工具调用、图像输入）
- 可以设置上下文大小

### 3. 配置验证

**maxContextRatio**：
- 范围：0 到 1
- 默认值：0.35
- 步进：0.0001
- 作用：控制实际使用的上下文大小比例

**temperature**：
- 范围：0 到 2
- 默认值：1
- 步进：0.1
- 作用：控制生成文本的随机性

**enableSearch**：
- 类型：布尔值
- 默认值：true
- 作用：是否启用搜索功能

### 4. 国际化支持

配置 Schema 支持多语言：
- 中文：`./locales/zh-CN.schema.yml`
- 英文：`./locales/en-US.schema.yml`

## 技术特点

1. **延迟初始化**：在 Koishi ready 事件后才初始化插件，确保依赖已就绪
2. **配置验证**：使用 Schema 进行严格的配置验证
3. **多 API 密钥支持**：支持配置多个 API 密钥，可以单独启用/禁用
4. **灵活的模型配置**：支持用户自定义添加额外模型
5. **国际化**：支持中英文配置界面
6. **依赖注入**：声明对 chatluna 插件的依赖

## 配置结构

```typescript
{
    // 基础配置（继承自 ChatLunaPlugin.Config）
    ...
    
    // API 密钥配置
    apiKeys: [
        ['密钥1', true],   // 启用
        ['密钥2', false],  // 禁用
        ...
    ],
    
    // 额外模型配置
    additionalModels: [
        {
            model: 'custom-model-name',
            modelType: 'LLM 大语言模型',
            modelCapabilities: [ModelCapabilities.ToolCall],
            contextSize: 128000
        },
        ...
    ],
    
    // 上下文配置
    maxContextRatio: 0.35,
    
    // 生成参数
    temperature: 1,
    
    // 搜索功能
    enableSearch: true
}
```

## 与其他文件的关系

1. **client.ts**：index.ts 创建并注册 QWenClient
2. **requester.ts**：QWenClient 使用 QWenRequester 进行 API 调用
3. **utils.ts**：提供消息和工具格式转换的工具函数
4. **types.ts**：定义 API 交互的数据结构

## 插件生命周期

```
加载 → apply() → 等待 ready → 初始化插件 → 注册客户端 → 就绪
```

这个文件是整个 Qwen 适配器的入口点，负责将插件集成到 Koishi 生态系统中，并管理配置和客户端的生命周期。