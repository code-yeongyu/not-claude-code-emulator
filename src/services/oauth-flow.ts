import { createHash, randomBytes } from 'node:crypto'
import { platform } from 'node:process'
import { ALL_OAUTH_SCOPES, CLAUDE_AI_INFERENCE_SCOPE, getOAuthConfig } from '../config/oauth.js'
import type { OAuthTokenExchangeResponse, OAuthTokens } from '../types/oauth.js'
import { AuthCodeListener } from './auth-code-listener.js'

function toBase64Url(input: Buffer): string {
	return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function generateCodeVerifier(): string {
	return toBase64Url(randomBytes(32))
}

function generateCodeChallenge(codeVerifier: string): string {
	return createHash('sha256').update(codeVerifier).digest('base64url')
}

function generateState(): string {
	return toBase64Url(randomBytes(24))
}

async function openBrowser(url: string): Promise<void> {
	const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'

	try {
		Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore' })
	} catch {}
}

export function parseScopes(scopeString?: string): string[] {
	return scopeString?.split(' ').filter(Boolean) ?? []
}

export function buildAuthUrl(options: {
	codeChallenge: string
	state: string
	port: number
	isManual: boolean
	loginWithClaudeAi?: boolean
	inferenceOnly?: boolean
	orgUUID?: string
	loginHint?: string
	loginMethod?: string
}): string {
	const config = getOAuthConfig()
	const authUrl = new URL(
		options.loginWithClaudeAi ? config.claudeAiAuthorizeUrl : config.consoleAuthorizeUrl,
	)

	authUrl.searchParams.append('code', 'true')
	authUrl.searchParams.append('client_id', config.clientId)
	authUrl.searchParams.append('response_type', 'code')
	authUrl.searchParams.append(
		'redirect_uri',
		options.isManual ? config.manualRedirectUrl : `http://localhost:${options.port}/callback`,
	)

	const scopesToUse = options.inferenceOnly ? [CLAUDE_AI_INFERENCE_SCOPE] : ALL_OAUTH_SCOPES
	authUrl.searchParams.append('scope', scopesToUse.join(' '))
	authUrl.searchParams.append('code_challenge', options.codeChallenge)
	authUrl.searchParams.append('code_challenge_method', 'S256')
	authUrl.searchParams.append('state', options.state)

	if (options.orgUUID) {
		authUrl.searchParams.append('orgUUID', options.orgUUID)
	}

	if (options.loginHint) {
		authUrl.searchParams.append('login_hint', options.loginHint)
	}

	if (options.loginMethod) {
		authUrl.searchParams.append('login_method', options.loginMethod)
	}

	return authUrl.toString()
}

export async function exchangeCodeForTokens(options: {
	authorizationCode: string
	state: string
	codeVerifier: string
	port: number
	useManualRedirect: boolean
	expiresIn?: number
}): Promise<OAuthTokenExchangeResponse> {
	const config = getOAuthConfig()
	const payload: Record<string, string | number> = {
		grant_type: 'authorization_code',
		code: options.authorizationCode,
		redirect_uri: options.useManualRedirect
			? config.manualRedirectUrl
			: `http://localhost:${options.port}/callback`,
		client_id: config.clientId,
		code_verifier: options.codeVerifier,
		state: options.state,
	}

	if (options.expiresIn !== undefined) {
		payload.expires_in = options.expiresIn
	}

	const response = await fetch(config.tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	})

	if (!response.ok) {
		throw new Error(
			response.status === 401
				? 'Authentication failed: Invalid authorization code'
				: `Token exchange failed (${response.status}): ${response.statusText}`,
		)
	}

	return (await response.json()) as OAuthTokenExchangeResponse
}

export async function refreshOAuthToken(
	refreshToken: string,
	options: { scopes?: string[] } = {},
): Promise<OAuthTokens> {
	const config = getOAuthConfig()
	const response = await fetch(config.tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: config.clientId,
			scope: (options.scopes?.length ? options.scopes : ALL_OAUTH_SCOPES).join(' '),
		}),
	})

	if (!response.ok) {
		throw new Error(`Token refresh failed (${response.status}): ${response.statusText}`)
	}

	const data = (await response.json()) as OAuthTokenExchangeResponse

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken,
		expiresAt: Date.now() + data.expires_in * 1000,
		scopes: parseScopes(data.scope),
	}
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
	if (expiresAt === null) {
		return false
	}

	return Date.now() + 5 * 60 * 1000 >= expiresAt
}

export class OAuthService {
	private readonly codeVerifier = generateCodeVerifier()
	private authCodeListener: AuthCodeListener | null = null
	private port: number | null = null
	private expectedState: string | null = null
	private manualAuthCodeResolver: ((authorizationCode: string) => void) | null = null

	async startOAuthFlow(
		authURLHandler: (manualUrl: string, automaticUrl?: string) => Promise<void>,
		options?: {
			loginWithClaudeAi?: boolean
			inferenceOnly?: boolean
			expiresIn?: number
			orgUUID?: string
			loginHint?: string
			loginMethod?: string
			skipBrowserOpen?: boolean
		},
	): Promise<OAuthTokens> {
		this.authCodeListener = new AuthCodeListener()
		this.port = await this.authCodeListener.start()

		const state = generateState()
		this.expectedState = state
		const codeChallenge = generateCodeChallenge(this.codeVerifier)
		const manualFlowUrl = buildAuthUrl({
			codeChallenge,
			state,
			port: this.port,
			isManual: true,
			loginWithClaudeAi: options?.loginWithClaudeAi,
			inferenceOnly: options?.inferenceOnly,
			orgUUID: options?.orgUUID,
			loginHint: options?.loginHint,
			loginMethod: options?.loginMethod,
		})
		const automaticFlowUrl = buildAuthUrl({
			codeChallenge,
			state,
			port: this.port,
			isManual: false,
			loginWithClaudeAi: options?.loginWithClaudeAi,
			inferenceOnly: options?.inferenceOnly,
			orgUUID: options?.orgUUID,
			loginHint: options?.loginHint,
			loginMethod: options?.loginMethod,
		})

		const authorizationCode = await this.waitForAuthorizationCode(state, async () => {
			await authURLHandler(manualFlowUrl, automaticFlowUrl)
			if (!options?.skipBrowserOpen) {
				await openBrowser(automaticFlowUrl)
			}
		})

		const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false

		try {
			const response = await exchangeCodeForTokens({
				authorizationCode,
				state,
				codeVerifier: this.codeVerifier,
				port: this.port,
				useManualRedirect: !isAutomaticFlow,
				expiresIn: options?.expiresIn,
			})

			if (isAutomaticFlow) {
				this.authCodeListener?.handleSuccessRedirect(parseScopes(response.scope))
			}

			return {
				accessToken: response.access_token,
				refreshToken: response.refresh_token ?? null,
				expiresAt: Date.now() + response.expires_in * 1000,
				scopes: parseScopes(response.scope),
			}
		} catch (error) {
			if (isAutomaticFlow) {
				this.authCodeListener?.handleErrorRedirect()
			}
			throw error
		} finally {
			this.expectedState = null
			this.authCodeListener?.close()
		}
	}

	handleManualAuthCodeInput(params: { authorizationCode: string; state: string }): boolean {
		if (!this.expectedState || params.state !== this.expectedState) {
			return false
		}

		if (!this.manualAuthCodeResolver) {
			return false
		}

		this.manualAuthCodeResolver(params.authorizationCode)
		this.manualAuthCodeResolver = null
		this.authCodeListener?.close()
		return true
	}

	cleanup(): void {
		this.authCodeListener?.close()
		this.expectedState = null
		this.manualAuthCodeResolver = null
	}

	private async waitForAuthorizationCode(
		state: string,
		onReady: () => Promise<void>,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			this.manualAuthCodeResolver = resolve
			this.authCodeListener
				?.waitForAuthorization(state, onReady)
				.then((authorizationCode) => {
					this.manualAuthCodeResolver = null
					resolve(authorizationCode)
				})
				.catch((error) => {
					this.manualAuthCodeResolver = null
					reject(error)
				})
		})
	}
}
