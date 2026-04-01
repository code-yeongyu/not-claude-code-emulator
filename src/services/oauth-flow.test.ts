import { afterEach, describe, expect, it } from 'bun:test'
import { getOAuthConfig } from '../config/oauth.js'
import { buildAuthUrl, isOAuthTokenExpired, parseScopes, refreshOAuthToken } from './oauth-flow.js'
import { OAuthService } from './oauth-flow.js'

const originalBaseUrl = process.env.ANTHROPIC_OAUTH_BASE_URL
const originalClientId = process.env.ANTHROPIC_OAUTH_CLIENT_ID
const originalFetch = globalThis.fetch

describe('oauth-flow', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
		if (originalBaseUrl === undefined) {
			delete process.env.ANTHROPIC_OAUTH_BASE_URL
		} else {
			process.env.ANTHROPIC_OAUTH_BASE_URL = originalBaseUrl
		}
		if (originalClientId === undefined) {
			delete process.env.ANTHROPIC_OAUTH_CLIENT_ID
		} else {
			process.env.ANTHROPIC_OAUTH_CLIENT_ID = originalClientId
		}
	})

	it('given setup-token mode when building auth url then it requests the inference scope', () => {
		process.env.ANTHROPIC_OAUTH_CLIENT_ID = 'test-client-id'

		const url = new URL(
			buildAuthUrl({
				codeChallenge: 'challenge',
				state: 'state',
				port: 5454,
				isManual: true,
				loginWithClaudeAi: true,
				inferenceOnly: true,
			}),
		)

		expect(url.searchParams.get('scope')).toBe('user:inference')
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://platform.claude.com/oauth/code/callback',
		)
		expect(url.searchParams.get('client_id')).toBe('test-client-id')
	})

	it('given a scope string when parsing scopes then it splits it into values', () => {
		expect(parseScopes('user:profile user:inference')).toEqual(['user:profile', 'user:inference'])
		expect(parseScopes(undefined)).toEqual([])
	})

	it('given a token expiry within five minutes when checking expiration then it is treated as expired', () => {
		expect(isOAuthTokenExpired(Date.now() + 60_000)).toBe(true)
		expect(isOAuthTokenExpired(Date.now() + 10 * 60_000)).toBe(false)
		expect(isOAuthTokenExpired(null)).toBe(false)
	})

	it('given a refresh token when refreshing then it returns refreshed oauth tokens', async () => {
		process.env.ANTHROPIC_OAUTH_BASE_URL = 'http://localhost:9999'
		process.env.ANTHROPIC_OAUTH_CLIENT_ID = 'test-client-id'
		const mockedFetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) =>
				new Response(
					JSON.stringify({
						access_token: 'refreshed-access-token',
						refresh_token: 'refreshed-refresh-token',
						expires_in: 3600,
						scope: 'user:profile user:inference',
					}),
					{ status: 200 },
				),
			{ preconnect: originalFetch.preconnect },
		)
		globalThis.fetch = mockedFetch

		const tokens = await refreshOAuthToken('existing-refresh-token')

		expect(tokens.accessToken).toBe('refreshed-access-token')
		expect(tokens.refreshToken).toBe('refreshed-refresh-token')
		expect(tokens.scopes).toEqual(['user:profile', 'user:inference'])
		expect(tokens.expiresAt).not.toBeNull()
	})

	it('given a mismatched manual state when handling manual auth input then it rejects the code', async () => {
		const oauthService = new OAuthService()
		const flowPromise = oauthService.startOAuthFlow(async () => {}, {
			skipBrowserOpen: true,
		})

		await Bun.sleep(10)
		const accepted = oauthService.handleManualAuthCodeInput({
			authorizationCode: 'code',
			state: 'wrong-state',
		})

		expect(accepted).toBe(false)
		oauthService.cleanup()
		await expect(flowPromise).rejects.toBeDefined()
	})

	it('given setup work failure when starting oauth flow then it rejects instead of hanging', async () => {
		const oauthService = new OAuthService()

		await expect(
			oauthService.startOAuthFlow(
				async () => {
					throw new Error('setup failed')
				},
				{ skipBrowserOpen: true },
			),
		).rejects.toThrow('setup failed')

		oauthService.cleanup()
	})

	it('given a non-localhost http override when loading oauth config then it rejects it', () => {
		process.env.ANTHROPIC_OAUTH_BASE_URL = 'http://example.com'

		expect(() => getOAuthConfig()).toThrow(
			'ANTHROPIC_OAUTH_BASE_URL must use https or localhost http',
		)
	})

	it('given oauth config when loading then it includes success redirect urls', () => {
		const config = getOAuthConfig()

		expect(config.consoleSuccessUrl).toContain('/oauth/code/success')
		expect(config.claudeAiSuccessUrl).toContain('/oauth/code/success')
	})
})
