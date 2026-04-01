import { describe, expect, it } from 'bun:test'
import { transformRequest } from '../services/request-transformer.js'
import type { MessageCreateParams } from '../types/messages.js'

describe('transformRequest', () => {
	it('should preserve tool names exactly as sent', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
			tools: [
				{
					name: 'get_user_data',
					description: 'Get user data',
					input_schema: { type: 'object', properties: {} },
				},
				{
					name: 'update_profile',
					description: 'Update profile',
					input_schema: { type: 'object', properties: {} },
				},
			],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.tools?.[0].name).toBe('get_user_data')
		expect(result.requestBody.tools?.[1].name).toBe('update_profile')
	})

	it('should inject Claude Code system prompt', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.system).toBeDefined()
		expect(Array.isArray(result.requestBody.system)).toBe(true)
		expect((result.requestBody.system as { text: string }[])[0].text).toContain('Claude Code')
	})

	it('should replace existing Claude Code system prompt to avoid duplication', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
			system: [
				{
					type: 'text',
					text: "You are Claude Code, Anthropic's official CLI for Claude.",
				},
				{ type: 'text', text: 'Additional context' },
			],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const system = result.requestBody.system as { text: string }[]
		expect(system.length).toBe(2)
		expect(system[0].text).toContain('Claude Code')
		expect(system[1].text).toBe('Additional context')
	})

	it('should preserve OpenCode in system prompt without replacement', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
			system: 'You are OpenCode, a helpful assistant.',
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const system = result.requestBody.system as { text: string }[]
		expect(system[1].text).toContain('OpenCode')
		expect(system[1].text).not.toContain('O P E N C O D E')
	})

	it('should parse thinking spec from model string', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929:2048',
			max_tokens: 4096,
			messages: [{ role: 'user', content: 'Hello' }],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.model).toBe('claude-sonnet-4-5-20250929')
		expect(result.requestBody.thinking).toEqual({
			type: 'enabled',
			budget_tokens: 2048,
		})
	})

	it('should set temperature to 1 when thinking is enabled', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929:high',
			max_tokens: 4096,
			messages: [{ role: 'user', content: 'Hello' }],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect(result.requestBody.thinking?.type).toBe('enabled')
		expect(result.requestBody.temperature).toBe(1)
	})

	it('should limit cache control blocks to maximum 4', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Message 1', cache_control: { type: 'ephemeral' } },
						{ type: 'text', text: 'Message 2', cache_control: { type: 'ephemeral' } },
						{ type: 'text', text: 'Message 3', cache_control: { type: 'ephemeral' } },
						{ type: 'text', text: 'Message 4', cache_control: { type: 'ephemeral' } },
						{ type: 'text', text: 'Message 5', cache_control: { type: 'ephemeral' } },
					],
				},
			],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const content = result.requestBody.messages[0].content as Array<{
			cache_control?: unknown
		}>
		const cacheCount = content.filter((block) => block.cache_control).length
		expect(cacheCount).toBeLessThanOrEqual(4)
	})

	it('should extract beta headers from request', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
		}

		const result = await transformRequest({
			body,
			headers: {
				'anthropic-beta': 'custom-beta-1,custom-beta-2',
			},
		})

		expect(result.anthropicBetaHeaders).toContain('custom-beta-1')
		expect(result.anthropicBetaHeaders).toContain('custom-beta-2')
	})

	it('should preserve tool_choice name exactly as sent', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [{ role: 'user', content: 'Hello' }],
			tool_choice: { type: 'tool', name: 'get_user_data' },
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		expect((result.requestBody.tool_choice as { name: string }).name).toBe('get_user_data')
	})

	it('should preserve tool_use block names in messages', async () => {
		const body: MessageCreateParams = {
			model: 'claude-sonnet-4-5-20250929',
			max_tokens: 1024,
			messages: [
				{
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'tool_123',
							name: 'fetch_user_info',
							input: {},
						},
					],
				},
			],
		}

		const result = await transformRequest({
			body,
			headers: {},
		})

		const content = result.requestBody.messages[0].content as Array<{ name: string }>
		expect(content[0].name).toBe('fetch_user_info')
	})
})
