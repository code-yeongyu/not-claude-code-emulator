import { getOAuthConfig } from '../config/oauth.js'
import type { OAuthTokens } from '../types/oauth.js'
import { computeCch, hasCchPlaceholder, replaceCchPlaceholder } from './cch.js'
import { isOAuthTokenExpired, refreshOAuthToken } from './oauth-flow.js'
import { loadStoredTokens, saveStoredTokens } from './token-store.js'

const OAUTH_TOKEN_PATTERN = /^sk-ant-oat01-[A-Za-z0-9_-]+$/
const PLACEHOLDER_TOKEN_PATTERNS = [
	'your_oauth_token_here',
	'your_api_key_here',
	'placeholder',
	'replace_me',
	'changeme',
] as const

export const REQUIRED_BETAS = [
	'claude-code-20250219',
	'oauth-2025-04-20',
	'interleaved-thinking-2025-05-14',
] as const

export const BASE_X_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	'x-stainless-timeout': '600',
	'x-stainless-lang': 'js',
	'x-stainless-package-version': '0.80.0',
	'x-stainless-os': 'MacOS',
	'x-stainless-arch': 'arm64',
	'x-stainless-runtime': 'node',
	'x-stainless-runtime-version': 'v24.3.0',
	'x-stainless-helper-method': 'stream',
	'x-stainless-retry-count': '0',
	'x-app': 'cli',
})

export const BASE_ANTHROPIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	host: 'api.anthropic.com',
	Accept: 'application/json',
	'content-type': 'application/json',
	'anthropic-version': '2023-06-01',
	'anthropic-dangerous-direct-browser-access': 'true',
	'accept-language': '*',
	'sec-fetch-mode': 'cors',
})

export interface OAuthTokenInfo {
	token: string
	isValid: boolean
	expiresAt?: Date
	scopes?: string[]
}

export interface AnthropicApiResponse<T> {
	data: T
	usage?: {
		input_tokens: number
		output_tokens: number
	}
}

export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AuthenticationError'
	}
}

export class RateLimitError extends Error {
	public readonly statusCode: number
	public readonly retryAfterSeconds: number | null

	constructor(message: string, statusCode = 429, retryAfterSeconds: number | null = null) {
		super(message)
		this.name = 'RateLimitError'
		this.statusCode = statusCode
		this.retryAfterSeconds = retryAfterSeconds
	}
}

export class RetryableError extends Error {
	public readonly statusCode?: number

	constructor(message: string, statusCode?: number) {
		super(message)
		this.name = 'RetryableError'
		this.statusCode = statusCode
	}
}

export class NonRetryableError extends Error {
	public readonly statusCode: number
	public readonly responseBody?: string

	constructor(message: string, statusCode: number, responseBody?: string) {
		super(message)
		this.name = 'NonRetryableError'
		this.statusCode = statusCode
		this.responseBody = responseBody
	}
}

export function validateOAuthToken(token: string): boolean {
	if (!token || typeof token !== 'string') {
		return false
	}
	return OAUTH_TOKEN_PATTERN.test(token.trim())
}

export function parseOAuthToken(headers: Record<string, string | undefined>): string {
	const authorization = headers['authorization']
	const apiKey = headers['x-api-key']

	if (apiKey && apiKey.trim()) {
		return apiKey.trim()
	}

	if (authorization) {
		const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)
		if (bearerMatch?.[1]) {
			return bearerMatch[1].trim()
		}
	}

	throw new AuthenticationError('Missing or invalid Authorization or x-api-key header')
}

function isPlaceholderToken(token: string): boolean {
	const normalizedToken = token.trim().toLowerCase()
	return PLACEHOLDER_TOKEN_PATTERNS.some((pattern) => normalizedToken.includes(pattern))
}

async function getStoredTokensWithRefresh(): Promise<OAuthTokens | null> {
	const storedTokens = await loadStoredTokens()
	if (!storedTokens) {
		return null
	}

	if (!storedTokens.refreshToken || !isOAuthTokenExpired(storedTokens.expiresAt)) {
		return storedTokens
	}

	const refreshedTokens = await refreshOAuthToken(storedTokens.refreshToken, {
		scopes: storedTokens.scopes,
	})
	await saveStoredTokens(refreshedTokens)
	return refreshedTokens
}

async function resolveFallbackOAuthToken(): Promise<string> {
	const envToken = process.env.ANTHROPIC_OAUTH_TOKEN?.trim()
	if (envToken && validateOAuthToken(envToken)) {
		return envToken
	}

	const storedTokens = await getStoredTokensWithRefresh()
	if (storedTokens?.accessToken && validateOAuthToken(storedTokens.accessToken)) {
		return storedTokens.accessToken
	}

	throw new AuthenticationError('Missing or invalid Authorization or x-api-key header')
}

export async function resolveOAuthToken(
	headers?: Record<string, string | undefined>,
	options: { allowStoredTokenFallback?: boolean } = {},
): Promise<string> {
	const allowStoredTokenFallback = options.allowStoredTokenFallback ?? true

	if (headers) {
		const hasAuthHeaders =
			typeof headers.authorization === 'string' || typeof headers['x-api-key'] === 'string'

		try {
			const headerToken = parseOAuthToken(headers)
			if (validateOAuthToken(headerToken)) {
				return headerToken
			}

			if (!(allowStoredTokenFallback && isPlaceholderToken(headerToken))) {
				throw new AuthenticationError('Invalid OAuth token in Authorization or x-api-key header')
			}
		} catch (error) {
			if (hasAuthHeaders && error instanceof AuthenticationError) {
				throw error
			}

			if (!(error instanceof AuthenticationError)) {
				throw error
			}
		}
	}

	if (!allowStoredTokenFallback) {
		throw new AuthenticationError('Missing or invalid Authorization or x-api-key header')
	}

	return resolveFallbackOAuthToken()
}

export function buildAnthropicHeaders(
	accessToken: string,
	options: {
		userAgent?: string
		anthropicBetaHeaders?: string[]
	} = {},
): Record<string, string> {
	const apiBaseUrl = new URL(getOAuthConfig().baseApiUrl)
	const userAgent = options.userAgent?.startsWith('claude-cli/')
		? options.userAgent
		: 'claude-cli/2.1.87 (external, cli)'

	const allBetas = [...new Set([...(options.anthropicBetaHeaders || []), ...REQUIRED_BETAS])]

	return {
		...BASE_X_HEADERS,
		...BASE_ANTHROPIC_HEADERS,
		host: apiBaseUrl.host,
		'user-agent': userAgent,
		authorization: `Bearer ${accessToken.trim()}`,
		'anthropic-beta': allBetas.join(','),
	}
}

function isNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false

	const errorCode = (error as { code?: string }).code
	const errorMessage = error.message.toLowerCase()

	return (
		error.name === 'TypeError' ||
		errorCode === 'ENOTFOUND' ||
		errorCode === 'ECONNREFUSED' ||
		errorCode === 'ETIMEDOUT' ||
		errorCode === 'ECONNRESET' ||
		errorCode === 'ENETUNREACH' ||
		errorMessage.includes('fetch failed') ||
		errorMessage.includes('network')
	)
}

export function parseRetryAfterHeaders(headers: Headers): number | null {
	const retryAfterMs = headers.get('retry-after-ms')
	if (retryAfterMs) {
		const msValue = Number.parseInt(retryAfterMs, 10)
		if (!isNaN(msValue)) {
			return Math.ceil(msValue / 1000)
		}
	}

	const retryAfter = headers.get('retry-after')
	if (retryAfter) {
		const numValue = Number.parseInt(retryAfter, 10)
		if (!isNaN(numValue)) {
			return numValue
		}
		const dateValue = Date.parse(retryAfter)
		if (!isNaN(dateValue)) {
			return Math.max(0, Math.ceil((dateValue - Date.now()) / 1000))
		}
	}

	return null
}

export async function verifyOAuthToken(token: string): Promise<OAuthTokenInfo> {
	if (!validateOAuthToken(token)) {
		return { token, isValid: false }
	}

	try {
		const headers = buildAnthropicHeaders(token)
		const apiBaseUrl = getOAuthConfig().baseApiUrl

		const response = await fetch(`${apiBaseUrl}/v1/models`, {
			method: 'GET',
			headers: {
				...headers,
				'anthropic-beta': 'oauth-2025-04-20',
			},
		})

		if (response.ok) {
			return { token, isValid: true }
		}

		if (response.status >= 400) {
			return { token, isValid: false }
		}

		return { token, isValid: false }
	} catch (error) {
		console.error('Token verification error:', error)
		return { token, isValid: false }
	}
}

export async function callAnthropicApi(
	endpoint: string,
	payload: unknown,
	accessToken?: string,
	options: {
		anthropicBetaHeaders?: string[]
		userAgent?: string
	} = {},
): Promise<Response> {
	const resolvedAccessToken = accessToken ?? (await resolveOAuthToken())
	let shouldRetryWithRefresh = accessToken === undefined

	try {
		const apiBaseUrl = getOAuthConfig().baseApiUrl
		const sendRequest = async (token: string): Promise<Response> => {
			let body = JSON.stringify(payload)

			// Compute and replace the cch placeholder with the xxHash64-based
			// integrity hash, matching the signing that real Claude Code performs
			// in Bun's native HTTP stack before sending the request.
			if (
				endpoint.includes('/v1/messages') &&
				hasCchPlaceholder(body)
			) {
				const cch = await computeCch(body)
				body = replaceCchPlaceholder(body, cch)
			}

			return fetch(`${apiBaseUrl}${endpoint}`, {
				method: 'POST',
				headers: {
					...buildAnthropicHeaders(token, options),
					'X-Stainless-Retry-Count': '0',
				},
				body,
			})
		}

		let res = await sendRequest(resolvedAccessToken)

		if (res.status === 401 && shouldRetryWithRefresh) {
			const refreshedTokens = await getStoredTokensWithRefresh()
			if (refreshedTokens?.accessToken && refreshedTokens.accessToken !== resolvedAccessToken) {
				res = await sendRequest(refreshedTokens.accessToken)
				shouldRetryWithRefresh = false
			}
		}

		if (res.ok) {
			return res
		}

		if (res.status === 429) {
			try {
				await res.text()
			} catch {
				res.body?.cancel()
			}

			const retryAfterSeconds = parseRetryAfterHeaders(res.headers)
			throw new RateLimitError('Rate limit exceeded (429)', res.status, retryAfterSeconds)
		}

		if (res.status === 403) {
			try {
				await res.text()
			} catch {
				res.body?.cancel()
			}
			throw new RetryableError(`Forbidden: ${res.status}`, res.status)
		}

		if (res.status >= 500) {
			try {
				await res.text()
			} catch {
				res.body?.cancel()
			}
			throw new RetryableError(`Server error: ${res.status}`, res.status)
		}

		if (res.status >= 400 && res.status < 500) {
			const responseBody = await res.text().catch(() => '[Failed to read response body]')
			throw new NonRetryableError(`Client error: ${res.status}`, res.status, responseBody)
		}

		return res
	} catch (error) {
		if (isNetworkError(error)) {
			throw new RetryableError(`Network error: ${(error as Error).message}`)
		}

		if (
			error instanceof RateLimitError ||
			error instanceof RetryableError ||
			error instanceof NonRetryableError
		) {
			throw error
		}

		throw error
	}
}
