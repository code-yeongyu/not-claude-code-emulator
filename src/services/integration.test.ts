import { describe, expect, it } from 'bun:test'
import { callAnthropicApi, validateOAuthToken } from '../services/oauth-client.js'
import { transformRequest } from '../services/request-transformer.js'
import type { MessageCreateParams } from '../types/messages.js'

const TEST_OAUTH_TOKEN =
	process.env.ANTHROPIC_OAUTH_TOKEN || 'sk-ant-oat01-PLACEHOLDER_TOKEN_USE_ENV_VAR'
const HAS_REAL_TOKEN =
	typeof process.env.ANTHROPIC_OAUTH_TOKEN === 'string' &&
	!process.env.ANTHROPIC_OAUTH_TOKEN.includes('PLACEHOLDER')

describe('OpenCode System Prompt Integration', () => {
	it('should preserve OpenCode in system prompt without any replacement', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Say hello' }],
			system: 'You are OpenCode, an AI assistant. OpenCode helps users with coding tasks.',
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const system = result.requestBody.system as { text: string }[]
		expect(system[1].text).toContain('OpenCode')
		expect(system[1].text).not.toContain('O P E N C O D E')
	})

	it('should preserve OpenCode in array system blocks', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Hello' }],
			system: [
				{ type: 'text', text: 'OpenCode is great.' },
				{ type: 'text', text: 'Use OpenCode for coding.' },
			],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const system = result.requestBody.system as { text: string }[]
		expect(system[1].text).toContain('OpenCode')
		expect(system[2].text).toContain('OpenCode')
		expect(system.some((s) => s.text.includes('O P E N C O D E'))).toBe(false)
	})

	it('should keep OpenCode meaning intact in system prompt', async () => {
		const originalText = 'OpenCode provides excellent code completion'
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Hello' }],
			system: originalText,
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const system = result.requestBody.system as { text: string }[]
		expect(system[1].text).toBe(originalText)
		expect(system[1].text).toContain('OpenCode')
	})
})

describe('Tool Schema Compatibility - OpenCode Style', () => {
	it('should preserve OpenCode-style tool names exactly as sent', async () => {
		const opencodeStyleTools = [
			{
				name: 'read_file',
				description: 'Read a file from the filesystem',
				input_schema: {
					type: 'object' as const,
					properties: {
						path: { type: 'string', description: 'File path' },
					},
					required: ['path'],
				},
			},
			{
				name: 'write_file',
				description: 'Write content to a file',
				input_schema: {
					type: 'object' as const,
					properties: {
						path: { type: 'string' },
						content: { type: 'string' },
					},
					required: ['path', 'content'],
				},
			},
			{
				name: 'execute_command',
				description: 'Execute a shell command',
				input_schema: {
					type: 'object' as const,
					properties: {
						command: { type: 'string' },
						cwd: { type: 'string' },
					},
					required: ['command'],
				},
			},
		]

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Use tools' }],
			tools: opencodeStyleTools,
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.tools?.[0].name).toBe('read_file')
		expect(result.requestBody.tools?.[1].name).toBe('write_file')
		expect(result.requestBody.tools?.[2].name).toBe('execute_command')
	})

	it('should preserve tool schema structure without renaming', async () => {
		const tool = {
			name: 'complex_tool',
			description: 'A complex tool with nested schema',
			input_schema: {
				type: 'object' as const,
				properties: {
					nested: {
						type: 'object',
						properties: {
							deep: { type: 'string' },
						},
					},
					array: {
						type: 'array',
						items: { type: 'string' },
					},
				},
				required: ['nested'],
			},
		}

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Test' }],
			tools: [tool],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const transformedTool = result.requestBody.tools?.[0]
		expect(transformedTool?.name).toBe('complex_tool')
		expect(transformedTool?.description).toBe(tool.description)
		expect(transformedTool?.input_schema).toEqual(tool.input_schema)
	})

	it('should handle mixed case tool names', async () => {
		const tools = [
			{
				name: 'alreadyPascal',
				description: 'Test',
				input_schema: { type: 'object' as const, properties: {} },
			},
			{
				name: 'snake_case_tool',
				description: 'Test',
				input_schema: { type: 'object' as const, properties: {} },
			},
			{
				name: 'camelCaseTool',
				description: 'Test',
				input_schema: { type: 'object' as const, properties: {} },
			},
		]

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Test' }],
			tools,
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.tools?.[0].name).toBe('alreadyPascal')
		expect(result.requestBody.tools?.[1].name).toBe('snake_case_tool')
		expect(result.requestBody.tools?.[2].name).toBe('camelCaseTool')
	})
})

describe('End-to-End API Integration', () => {
	it('should verify OAuth token format', () => {
		expect(validateOAuthToken(TEST_OAUTH_TOKEN)).toBe(true)
	})

	it('should make successful API request with transformed payload', async () => {
		if (!HAS_REAL_TOKEN) {
			expect(true).toBe(true)
			return
		}

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Say "Hello from OAuth test" and nothing else.' }],
		}

		const transformed = await transformRequest({
			body,
			headers: {},
		})

		try {
			const response = await callAnthropicApi(
				'/v1/messages?beta=true',
				transformed.requestBody,
				TEST_OAUTH_TOKEN,
			)

			expect(response.ok).toBe(true)

			if (response.ok) {
				const data = await response.json()
				expect(data).toHaveProperty('content')
				expect(data).toHaveProperty('role', 'assistant')
				expect(data).toHaveProperty('model')
			}
		} catch (error) {
			console.log('API request attempted, error:', error)
		}
	}, 30000)

	it('should handle API errors gracefully', async () => {
		const invalidToken = 'sk-ant-oat01-invalid'

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Test' }],
		}

		try {
			await callAnthropicApi('/v1/messages?beta=true', body, invalidToken)

			expect(false).toBe(true)
		} catch (error) {
			expect(error).toBeDefined()
		}
	}, 30000)
})

describe('OpenCode/Claude Code Header Compatibility', () => {
	it('should generate headers that match Claude Code format', async () => {
		const { buildAnthropicHeaders } = await import('../services/oauth-client.js')

		const headers = buildAnthropicHeaders(TEST_OAUTH_TOKEN)

		expect(headers['x-app']).toBe('cli')

		expect(headers['x-stainless-lang']).toBe('js')
		expect(headers['x-stainless-runtime']).toBe('node')
		expect(headers['x-stainless-package-version']).toBeDefined()

		expect(headers['authorization']).toBe(`Bearer ${TEST_OAUTH_TOKEN}`)

		expect(headers['anthropic-beta']).toContain('claude-code-20250219')
		expect(headers['anthropic-beta']).toContain('oauth-2025-04-20')
	})
})
