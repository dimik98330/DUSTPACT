import {
  createSignableMessage,
  getBase64Decoder,
  isMessagePartialSigner,
  isMessageModifyingSigner,
  type TransactionSigner,
} from "@solana/kit";

export interface CommunitySession {
  address: string;
  csrfToken: string;
  expiresAt: string;
}
export interface CommunityRoom {
  id: string;
  matchAddress: string;
  title: string;
  hostAddress: string;
}
export interface ChatMessage {
  id: string;
  address: string;
  text: string | null;
  createdAt: string;
  hidden?: boolean;
  clientId?:string|null;
}
export type ChatEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "presence"; addresses: string[] }
  | { type: "moderated"; messageId: string }
  | { type: "ack"; clientId:string; message:ChatMessage }
  | { type: "error"; code: string; clientId?:string };
export class CommunityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      code === "AUTH_REQUIRED"
        ? "Для чата нужна подпись входа."
        : status === 429
          ? "Слишком много запросов. Подождите немного."
          : status === 503
            ? "Чат временно недоступен. Игра продолжает работать через Solana."
            : `Сервис сообщений: ${code}`,
    );
  }
}
function checkedMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.length < 40 &&
    typeof m.address === "string" &&
    m.address.length <= 44 &&
    (typeof m.text === "string"&&Array.from(m.text).length<=500||m.hidden===true&&m.text===null) &&
    typeof m.createdAt === "string"
  );
}
/** No game commitments, preimages or authoritative state are posted by this client. */
export class CommunityClient<TCluster extends string='localnet'|'devnet'> {
  session: CommunitySession | null = null;
  private authFlight: Promise<CommunitySession> | null = null;
  private authActor:string|null=null;
  constructor(
    readonly baseURL: string,
    readonly origin: string,
    readonly cluster:TCluster,
    readonly apiVersion:'v2'='v2',
    readonly authStatement='Sign in to the optional chat service. This does not authorize game actions or transfer funds.',
  ) {
    const url = new URL(baseURL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !!url.username||!!url.password||!!url.search||!!url.hash||
      (url.protocol === "http:" &&
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
      throw Error(
        "Сервис сообщений должен использовать HTTPS или локальное подключение.",
      );
    if (new URL(origin).origin !== origin)
      throw Error("Неверный адрес приложения.");
  }
  async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    config: { abortSignal?: AbortSignal } = {},
  ): Promise<T> {
    config.abortSignal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(
        `${this.baseURL.replace(/\/$/, "")}/api/${this.apiVersion}${path}`,
        {
          method,
          credentials: "include",
          headers: {
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(this.session ? { "X-CSRF-Token": this.session.csrfToken } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: config.abortSignal
            ? AbortSignal.any([config.abortSignal, AbortSignal.timeout(7000)])
            : AbortSignal.timeout(7000),
        },
      );
    } catch {
      config.abortSignal?.throwIfAborted();
      throw new CommunityError(503, "SERVICE_UNAVAILABLE");
    }
    const raw = await response.text();
    config.abortSignal?.throwIfAborted();
    if (raw.length > 1_000_000) throw new CommunityError(503, "RESPONSE_LIMIT");
    let value: any;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new CommunityError(503, "INVALID_RESPONSE");
    }
    if (!response.ok)
      throw new CommunityError(
        response.status,
        typeof value?.error?.code === "string"
          ? value.error.code
          : "REQUEST_FAILED",
      );
    return value as T;
  }
  async authenticate(
    signer: TransactionSigner,
    config: { abortSignal?: AbortSignal; validateContext?:()=>Promise<void> } = {},
  ): Promise<CommunitySession> {
    config.abortSignal?.throwIfAborted();
    if (this.authFlight) {if(this.authActor!==signer.address)throw Error('Wallet changed during chat sign-in');return this.authFlight;}
    this.authActor=signer.address;
    this.authFlight = this.login(signer, config.abortSignal,config.validateContext).finally(() => {
      this.authFlight = null;
      this.authActor=null;
    });
    return this.authFlight;
  }
  private async login(
    signer: TransactionSigner,
    abortSignal?: AbortSignal,
    validateContext?:()=>Promise<void>,
  ): Promise<CommunitySession> {
    try {
      const existing = await this.request<CommunitySession>(
        "/auth/session",
        undefined,
        "GET",
        { abortSignal },
      );
      if (existing.address === signer.address) {
        await validateContext?.();abortSignal?.throwIfAborted();
        this.session = existing;
        return existing;
      }
    } catch (e) {
      if (!(e instanceof CommunityError) || e.status !== 401) throw e;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      abortSignal?.throwIfAborted();
      const c = await this.request<{
        challengeId: string;
        message: string;
        expiresAt: string;
      }>(
        "/auth/challenge",
        {
          address: signer.address,
          origin: this.origin,
          cluster: this.cluster,
        },
        "POST",
        { abortSignal },
      );
      if (
        typeof c.message !== "string" ||
        c.message.length > 2048 ||
        typeof c.challengeId !== "string"
      )
        throw Error("Сервис вернул неверный запрос подписи.");
      const lines = c.message.split("\n"),
        nonce = lines.find((l) => l.startsWith("Nonce: "))?.slice(7),
        issued = lines.find((l) => l.startsWith("Issued At: "))?.slice(11),
        expires = lines
          .find((l) => l.startsWith("Expiration Time: "))
          ?.slice(17);
      const expected = `${new URL(this.origin).host} wants you to sign in to DUSTPACT:\n${signer.address}\n\n${this.authStatement}\n\nURI: ${this.origin}\nVersion: 1\nChain ID: solana:${this.cluster}\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${expires}`;
      if (
        c.message !== expected ||
        !nonce ||
        !/^[-\w]{43}$/.test(nonce) ||
        !issued ||
        !expires ||
        Date.parse(expires) - Date.parse(issued) !== 300_000
      )
        throw Error(
          "Запрос подписи не соответствует адресу, сети и цели входа в чат.",
        );
      const message = createSignableMessage(c.message);
      await validateContext?.();
      abortSignal?.throwIfAborted();
      let signature;
      if (isMessagePartialSigner(signer)) {
        const [signed] = await signer.signMessages([message]);
        signature = signed[signer.address];
      } else if (isMessageModifyingSigner(signer)) {
        const [signed] = await signer.modifyAndSignMessages([message]);
        if (
          !signed.content.every((b, i) => b === message.content[i]) ||
          signed.content.length !== message.content.length
        )
          throw Error("Кошелёк изменил сообщение входа.");
        signature = signed.signatures[signer.address];
      } else
        throw Error("Этот кошелёк не поддерживает подпись сообщения входа.");
      if (!signature || signature.length !== 64)
        throw Error("Кошелёк не вернул подпись входа.");
      await validateContext?.();
      abortSignal?.throwIfAborted();
      try {
        const session = await this.request<CommunitySession>(
          "/auth/verify",
          {
            challengeId: c.challengeId,
            signature: getBase64Decoder().decode(signature),
          },
          "POST",
          { abortSignal },
        );
        if (
          session.address !== signer.address ||
          typeof session.csrfToken !== "string"
        )
          throw Error("Неверный профиль сервиса.");
        this.session = session;
        return session;
      } catch (e) {
        if (
          attempt === 0 &&
          e instanceof CommunityError &&
          e.code === "CHALLENGE_EXPIRED_OR_USED"
        ) {
          try {
            const existing = await this.request<CommunitySession>(
              "/auth/session",
              undefined,
              "GET",
              { abortSignal },
            );
            if (existing.address === signer.address) {
              this.session = existing;
              return existing;
            }
          } catch {}
          continue;
        }
        throw e;
      }
    }
    throw new CommunityError(401, "AUTH_REQUIRED");
  }
  async room(matchAddress: string, title: string, ownerAddress: string) {
    return this.request<CommunityRoom>("/rooms", {
      matchAddress,
      title,
      ownerAddress,
    });
  }
  async messages(room: string) {
    const result = await this.request<{
      messages: unknown[];
      nextCursor: string | null;
    }>(`/rooms/${encodeURIComponent(room)}/messages`);
    if (!Array.isArray(result.messages) || result.messages.length > 100)
      throw Error("Неверная история сообщений.");
    return result.messages.filter(checkedMessage);
  }
  async connect(
    room: string,
    onEvent: (event: ChatEvent) => void,
    onClose: () => void,
    config:{abortSignal?:AbortSignal}={},
  ) {
    const { ticket } = await this.request<{ ticket: string }>(
      `/rooms/${encodeURIComponent(room)}/ticket`,
      {},
      'POST',config,
    );
    if (typeof ticket !== "string" || !/^[-\w]{43}$/.test(ticket))
      throw Error("Неверное разрешение чата.");
    config.abortSignal?.throwIfAborted();
    const url = new URL(
      `${this.baseURL.replace(/\/$/, "")}/api/${this.apiVersion}/rooms/${encodeURIComponent(room)}/socket`,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    const socket = new WebSocket(url);
    socket.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data.length > 8192) return;
      let event: any;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type === "message" && checkedMessage(event.message))
        onEvent(event);
      else if(this.apiVersion==='v2'&&event.type==='ack'&&typeof event.clientId==='string'&&checkedMessage(event.message)&&event.message.clientId===event.clientId)
        onEvent(event);
      else if (
        event.type === "presence" &&
        Array.isArray(event.addresses) &&
        event.addresses.length <= 12 &&
        event.addresses.every(
          (v: unknown) => typeof v === "string" && v.length <= 44,
        )
      )
        onEvent(event);
      else if (
        event.type === "moderated" &&
        typeof event.messageId === "string"
      )
        onEvent(event);
      else if (event.type === "error" && typeof event.code === "string")
        onEvent({type:'error',code:event.code,...(typeof event.clientId==='string'?{clientId:event.clientId}:{})});
    };
    socket.onclose = onClose;
    return socket;
  }
  async report(roomId: string, messageId: string) {
    return this.request("/reports", {
      roomId,
      messageId,
      reason: "Сообщение мешает безопасной игре",
    });
  }
  async moderate(roomId: string, messageId: string) {
    return this.request(`/rooms/${encodeURIComponent(roomId)}/moderate`, {
      messageId,
    });
  }
  async logout() {
    try {
      await this.request("/auth/logout", {});
    } finally {
      this.session = null;
    }
  }
}
