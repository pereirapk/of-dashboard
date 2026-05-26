import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const STATE_FILE = resolve(
  process.cwd(),
  "scripts/mcp-discovery/.auth-state.json"
);

interface PersistedState {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

async function loadState(): Promise<PersistedState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

async function saveState(state: PersistedState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export class FileOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly redirectUri: string,
    private readonly onAuthorizationUrl: (url: URL) => void | Promise<void> = () => {}
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Cumbuca Dashboard — Discovery",
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid profile offline_access open-finance",
      token_endpoint_auth_method: "client_secret_basic",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await loadState()).client;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const state = await loadState();
    state.client = info;
    await saveState(state);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await loadState()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state = await loadState();
    state.tokens = tokens;
    await saveState(state);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    await this.onAuthorizationUrl(url);
  }

  async saveCodeVerifier(v: string): Promise<void> {
    const state = await loadState();
    state.codeVerifier = v;
    await saveState(state);
  }

  async codeVerifier(): Promise<string> {
    const state = await loadState();
    if (!state.codeVerifier) {
      throw new Error("No code verifier saved — was redirectToAuthorization called first?");
    }
    return state.codeVerifier;
  }
}
