import { describe, expect, it } from 'bun:test'
import type { MessageCreateParams } from '../types/messages.js'
import { callAnthropicApi } from './oauth-client.js'
import { transformRequest } from './request-transformer.js'

const TEST_TOKEN = process.env.ANTHROPIC_OAUTH_TOKEN || 'sk-ant-oat01-PLACEHOLDER_TOKEN_USE_ENV_VAR'
const HAS_REAL_TOKEN =
	typeof process.env.ANTHROPIC_OAUTH_TOKEN === 'string' &&
	!process.env.ANTHROPIC_OAUTH_TOKEN.includes('PLACEHOLDER')

describe('Real API Calls with read_file Tool Schema', () => {
	it('should make successful API request with read_file style tools', async () => {
		if (!HAS_REAL_TOKEN) {
			expect(true).toBe(true)
			return
		}

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 500,
			messages: [
				{
					role: 'user',
					content:
						'I have a file at /tmp/test.txt. Can you read it? Just acknowledge you can help with that.',
				},
			],
			system: [
				{
					type: 'text',
					text: 'You are OpenCode, a coding assistant with access to file system tools.',
				},
				{
					type: 'text',
					text: 'Always use available tools when appropriate.',
				},
			],
			tools: [
				{
					name: 'read_file',
					description: 'Read the contents of a file at the specified path',
					input_schema: {
						type: 'object' as const,
						properties: {
							path: {
								type: 'string',
								description: 'The absolute path to the file to read',
							},
						},
						required: ['path'],
					},
				},
				{
					name: 'write_file',
					description: 'Write content to a file at the specified path',
					input_schema: {
						type: 'object' as const,
						properties: {
							path: {
								type: 'string',
								description: 'The absolute path to the file to write',
							},
							content: {
								type: 'string',
								description: 'The content to write to the file',
							},
						},
						required: ['path', 'content'],
					},
				},
				{
					name: 'execute_command',
					description: 'Execute a shell command in the terminal',
					input_schema: {
						type: 'object' as const,
						properties: {
							command: {
								type: 'string',
								description: 'The shell command to execute',
							},
							cwd: {
								type: 'string',
								description: 'The working directory for the command (optional)',
							},
						},
						required: ['command'],
					},
				},
			],
		}

		const transformed = await transformRequest({
			body,
			headers: {},
		})

		console.log(
			'System prompt (with OpenCode intact):',
			(transformed.requestBody.system as { text: string }[])[1]?.text,
		)
		console.log(
			'Tool names:',
			transformed.requestBody.tools?.map((t) => t.name),
		)
		console.log('Tool schemas present:', transformed.requestBody.tools?.length)

		expect(transformed.requestBody.tools?.[0].name).toBe('read_file')
		expect(transformed.requestBody.tools?.[1].name).toBe('write_file')
		expect(transformed.requestBody.tools?.[2].name).toBe('execute_command')

		const systemTexts = (transformed.requestBody.system as { text: string }[]).map((s) => s.text)
		expect(systemTexts.some((t) => t.includes('OpenCode'))).toBe(true)
		expect(systemTexts.some((t) => t.includes('O P E N C O D E'))).toBe(false)

		const response = await callAnthropicApi(
			'/v1/messages?beta=true',
			transformed.requestBody,
			TEST_TOKEN,
		)

		if (response.ok) {
			const data = await response.json()
			const text = data.content.map((c: { text?: string }) => c.text).join('')
			console.log('API Response:', text)

			expect(data).toHaveProperty('content')
			expect(data).toHaveProperty('role', 'assistant')
			expect(data).toHaveProperty('stop_reason')
		} else {
			const error = await response.text()
			console.error('API Error:', response.status, error)
			throw new Error(`API request failed: ${response.status}`)
		}
	}, 60000)

	it('should handle complex multi-tool request like OpenCode', async () => {
		if (!HAS_REAL_TOKEN) {
			expect(true).toBe(true)
			return
		}

		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1000,
			messages: [
				{
					role: 'user',
					content:
						'Check the current directory and read package.json if it exists. List your available tools.',
				},
			],
			system:
				'You are OpenCode, a coding assistant. You have access to tools: read_file, write_file, execute_command, search_files.',
			tools: [
				{
					name: 'read_file',
					description: 'Read file contents',
					input_schema: {
						type: 'object' as const,
						properties: {
							path: { type: 'string' },
						},
						required: ['path'],
					},
				},
				{
					name: 'write_file',
					description: 'Write file contents',
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
					description: 'Execute shell command',
					input_schema: {
						type: 'object' as const,
						properties: {
							command: { type: 'string' },
							cwd: { type: 'string' },
						},
						required: ['command'],
					},
				},
				{
					name: 'search_files',
					description: 'Search for files matching a pattern',
					input_schema: {
						type: 'object' as const,
						properties: {
							pattern: { type: 'string' },
							path: { type: 'string' },
						},
						required: ['pattern'],
					},
				},
			],
		}

		const transformed = await transformRequest({
			body,
			headers: {},
		})

		console.log(
			'Tool names:',
			transformed.requestBody.tools?.map((t) => t.name),
		)
		console.log(
			'System includes OpenCode:',
			(transformed.requestBody.system as { text: string }[]).some((s) =>
				s.text.includes('OpenCode'),
			),
		)

		expect(transformed.requestBody.tools?.length).toBe(4)
		expect(transformed.requestBody.tools?.map((t) => t.name)).toContain('read_file')
		expect(transformed.requestBody.tools?.map((t) => t.name)).toContain('search_files')

		const response = await callAnthropicApi(
			'/v1/messages?beta=true',
			transformed.requestBody,
			TEST_TOKEN,
		)

		if (response.ok) {
			const data = await response.json()
			const text = data.content.map((c: { text?: string }) => c.text).join('')
			console.log('Response:', text.substring(0, 200) + '...')

			expect(data.content).toBeInstanceOf(Array)
		} else {
			const error = await response.text()
			console.error('API Error:', response.status, error)
			throw new Error(`API request failed: ${response.status}`)
		}
	}, 60000)
})

describe('OpenCode preserved in system prompt', () => {
	it('should keep OpenCode unchanged in system prompt', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Hello' }],
			system: 'You are OpenCode, the best coding assistant.',
		}

		const transformed = await transformRequest({
			body,
			headers: {},
		})

		const system = transformed.requestBody.system as { text: string }[]
		const openCodeBlock = system.find((s) => s.text.includes('OpenCode'))

		expect(openCodeBlock).toBeDefined()
		expect(openCodeBlock?.text).toBe('You are OpenCode, the best coding assistant.')
		expect(openCodeBlock?.text).not.toContain('O P E N C O D E')
	})

	it('should keep OpenCode in array system blocks', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 100,
			messages: [{ role: 'user', content: 'Hello' }],
			system: [
				{ type: 'text', text: 'OpenCode is great.' },
				{ type: 'text', text: 'Use OpenCode for coding.' },
			],
		}

		const transformed = await transformRequest({
			body,
			headers: {},
		})

		const system = transformed.requestBody.system as { text: string }[]
		expect(system.some((s) => s.text === 'OpenCode is great.')).toBe(true)
		expect(system.some((s) => s.text === 'Use OpenCode for coding.')).toBe(true)
		expect(system.some((s) => s.text.includes('O P E N C O D E'))).toBe(false)
	})
})
