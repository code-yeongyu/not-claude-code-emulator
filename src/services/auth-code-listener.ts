import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getOAuthConfig } from '../config/oauth.js'

function shouldUseClaudeAiAuth(scopes: string[]): boolean {
	return scopes.includes('user:inference')
}

export class AuthCodeListener {
	private readonly localServer: Server
	private readonly callbackPath: string
	private port = 0
	private promiseResolver: ((authorizationCode: string) => void) | null = null
	private promiseRejecter: ((error: Error) => void) | null = null
	private expectedState: string | null = null
	private pendingResponse: ServerResponse | null = null

	constructor(callbackPath = '/callback') {
		this.localServer = createServer()
		this.callbackPath = callbackPath
	}

	async start(port?: number): Promise<number> {
		return new Promise((resolve, reject) => {
			this.localServer.once('error', (error) => {
				reject(new Error(`Failed to start OAuth callback server: ${error.message}`))
			})

			this.localServer.listen(port ?? 0, 'localhost', () => {
				const address = this.localServer.address() as AddressInfo
				this.port = address.port
				resolve(this.port)
			})
		})
	}

	hasPendingResponse(): boolean {
		return this.pendingResponse !== null
	}

	async waitForAuthorization(state: string, onReady: () => Promise<void>): Promise<string> {
		return new Promise((resolve, reject) => {
			this.promiseResolver = resolve
			this.promiseRejecter = reject
			this.expectedState = state
			this.localServer.on('request', this.handleRedirect.bind(this))
			this.localServer.on('error', this.handleError.bind(this))
			void onReady().catch((error) => {
				this.handleError(error instanceof Error ? error : new Error(String(error)))
			})
		})
	}

	handleSuccessRedirect(scopes: string[]): void {
		if (!this.pendingResponse) {
			return
		}

		const successUrl = shouldUseClaudeAiAuth(scopes)
			? getOAuthConfig().claudeAiSuccessUrl
			: getOAuthConfig().consoleSuccessUrl

		this.pendingResponse.writeHead(302, { Location: successUrl })
		this.pendingResponse.end()
		this.pendingResponse = null
	}

	handleErrorRedirect(): void {
		if (!this.pendingResponse) {
			return
		}

		this.pendingResponse.writeHead(302, { Location: getOAuthConfig().claudeAiSuccessUrl })
		this.pendingResponse.end()
		this.pendingResponse = null
	}

	close(): void {
		if (this.promiseRejecter) {
			this.reject(new Error('OAuth flow cancelled'))
		}

		if (this.pendingResponse) {
			this.handleErrorRedirect()
		}

		this.localServer.removeAllListeners()
		this.localServer.close()
	}

	private handleRedirect(req: IncomingMessage, res: ServerResponse): void {
		const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)

		if (parsedUrl.pathname !== this.callbackPath) {
			res.writeHead(404)
			res.end()
			return
		}

		const authorizationCode = parsedUrl.searchParams.get('code') ?? undefined
		const state = parsedUrl.searchParams.get('state') ?? undefined

		if (!authorizationCode) {
			res.writeHead(400)
			res.end('Authorization code not found')
			this.reject(new Error('No authorization code received'))
			return
		}

		if (state !== this.expectedState) {
			res.writeHead(400)
			res.end('Invalid state parameter')
			this.reject(new Error('Invalid state parameter'))
			return
		}

		this.pendingResponse = res
		this.resolve(authorizationCode)
	}

	private handleError(error: Error): void {
		this.reject(error)
		this.close()
	}

	private resolve(authorizationCode: string): void {
		if (!this.promiseResolver) {
			return
		}

		this.promiseResolver(authorizationCode)
		this.promiseResolver = null
		this.promiseRejecter = null
	}

	private reject(error: Error): void {
		if (!this.promiseRejecter) {
			return
		}

		this.promiseRejecter(error)
		this.promiseResolver = null
		this.promiseRejecter = null
	}
}
