import {
  type CreateTask,
  type Availability,
  type DocumentKind,
  type ErrorCode,
  type HelperApplication,
  type HelperProfile,
  type GeoPoint,
  type NearbyTaskList,
  type OfferResult,
  type SetAvailability,
  type TaskOfferList,
  type HelperBooking,
  type HelperBookingList,
  type Task,
  type TaskInterpretation,
  type TaskList,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
  type OtpVerifyResponse,
  type TokenPair,
  type UpdateMe,
  type User,
  apiErrorSchema,
  otpRequestResponseSchema,
  availabilitySchema,
  helperBookingListSchema,
  helperProfileResponseSchema,
  helperProfileSchema,
  nearbyTaskListSchema,
  offerResultSchema,
  taskOfferListSchema,
  helperBookingSchema,
  otpVerifyResponseSchema,
  taskInterpretationSchema,
  taskListSchema,
  taskSchema,
  tokenPairSchema,
  userSchema,
} from '@sibimate/shared';
import type { z } from 'zod';

/** An error answer from the API, or `network` when it could not be reached. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode | 'network',
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientOptions {
  /** For example https://api.sibimate.com/v1 */
  baseUrl: string;
  deviceId: () => string;
  getTokens: () => Tokens | null;
  /** Called with the new pair after a refresh, and with null when the session has ended. */
  onTokens: (tokens: Tokens | null) => void;
  fetch?: typeof fetch;
}

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  schema?: S;
  /** Send the access token, and refresh it once on a 401. Default true. */
  auth?: boolean;
  headers?: Record<string, string>;
}

/**
 * A small typed client for the Sibimate API. It is written by hand against the
 * schemas in @sibimate/shared until the API publishes an OpenAPI document.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  let refreshing: Promise<boolean> | null = null;

  async function send(
    path: string,
    method: string,
    body: unknown,
    accessToken?: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    try {
      return await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers: {
          // A form sets its own content type, with the boundary between its parts.
          ...(body !== undefined && !(body instanceof FormData) && { 'Content-Type': 'application/json' }),
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
          ...headers,
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiClientError('network', cause instanceof Error ? cause.message : 'Network request failed');
    }
  }

  async function toError(response: Response): Promise<ApiClientError> {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    return parsed.success
      ? new ApiClientError(parsed.data.code, parsed.data.message, response.status, parsed.data.details)
      : new ApiClientError('internal', `Request failed with status ${response.status}`, response.status);
  }

  /** Spends the refresh token. Calls made at the same moment share one refresh. */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const tokens = options.getTokens();
      if (!tokens) {
        return false;
      }
      const response = await send('/auth/refresh', 'POST', {
        refreshToken: tokens.refreshToken,
        deviceId: options.deviceId(),
      });
      if (!response.ok) {
        // Only a refusal ends the session; a server fault keeps it for the next try.
        if (response.status === 401) {
          options.onTokens(null);
        }
        return false;
      }
      const pair = tokenPairSchema.parse(await response.json());
      options.onTokens({
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      });
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<S extends z.ZodType | undefined = undefined>(
    path: string,
    { method = 'GET', body, schema, auth = true, headers }: RequestOptions<S> = {},
  ): Promise<S extends z.ZodType ? z.infer<S> : void> {
    let response = await send(path, method, body, auth ? options.getTokens()?.accessToken : undefined, headers);
    if (response.status === 401 && auth && (await refresh())) {
      response = await send(path, method, body, options.getTokens()?.accessToken, headers);
    }
    if (!response.ok) {
      throw await toError(response);
    }
    return (schema ? schema.parse(await response.json()) : undefined) as S extends z.ZodType ? z.infer<S> : void;
  }

  return {
    requestOtp: (phone: string): Promise<OtpRequestResponse> =>
      request('/auth/otp/request', {
        method: 'POST',
        body: { phone, deviceId: options.deviceId() } satisfies OtpRequest,
        schema: otpRequestResponseSchema,
        auth: false,
      }),

    verifyOtp: (phone: string, code: string): Promise<OtpVerifyResponse> =>
      request('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code, deviceId: options.deviceId() } satisfies OtpVerify,
        schema: otpVerifyResponseSchema,
        auth: false,
      }),

    logout: (refreshToken: string): Promise<void> =>
      request('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      }),

    getMe: (): Promise<User> => request('/me', { schema: userSchema }),

    updateMe: (changes: UpdateMe): Promise<User> =>
      request('/me', { method: 'PATCH', body: changes, schema: userSchema }),

    /** Asks for AI-written task details. Throws `interpreter_unavailable` when the typed form should be used. */
    interpretTask: (text: string): Promise<TaskInterpretation> =>
      request('/tasks/interpret', { method: 'POST', body: { text }, schema: taskInterpretationSchema }),

    /**
     * Sends a voice recording and gets back what was heard, as `inputText`, with the task details.
     * On a phone pass `{ uri, name, type }` for the recorded file; in a browser pass a Blob.
     */
    interpretVoice: (audio: Blob | { uri: string; name: string; type: string }): Promise<TaskInterpretation> => {
      const form = new FormData();
      // React Native's FormData takes the { uri, name, type } form, which the web types do not describe.
      form.append('audio', audio as Blob, audio instanceof Blob ? 'task.webm' : audio.name);
      return request('/tasks/interpret', { method: 'POST', body: form, schema: taskInterpretationSchema });
    },

    /** Posts a task. Reuse `idempotencyKey` when retrying, so a weak connection never posts it twice. */
    createTask: (task: CreateTask, idempotencyKey: string): Promise<Task> =>
      request('/tasks', {
        method: 'POST',
        body: task,
        schema: taskSchema,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),

    listTasks: (query: { status?: 'active' | 'all'; cursor?: string; limit?: number } = {}): Promise<TaskList> => {
      const params = new URLSearchParams(
        Object.entries(query).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
      );
      return request(`/tasks${params.size ? `?${params}` : ''}`, { schema: taskListSchema });
    },

    getTask: (id: string): Promise<Task> => request(`/tasks/${id}`, { schema: taskSchema }),

    cancelTask: (id: string): Promise<Task> => request(`/tasks/${id}/cancel`, { method: 'POST', schema: taskSchema }),

    // Helper (Earn mode). These need an approved helper; others get `forbidden`.

    listHelperBookings: (): Promise<HelperBookingList> =>
      request('/helper/bookings', { schema: helperBookingListSchema }),

    getHelperBooking: (id: string): Promise<HelperBooking> =>
      request(`/helper/bookings/${id}`, { schema: helperBookingSchema }),

    /** Moves a job on. `start` and `complete` need the code the customer reads out. */
    bookingStep: (
      id: string,
      step: 'en-route' | 'start' | 'complete' | 'payment/cash-received' | 'cancel',
      code?: string,
    ): Promise<HelperBooking> =>
      request(`/bookings/${id}/${step}`, {
        method: 'POST',
        body: code === undefined ? undefined : { code },
        schema: helperBookingSchema,
      }),

    getAvailability: (): Promise<Availability> => request('/helper/availability', { schema: availabilitySchema }),

    /** Goes online or offline. Going online for the first time needs `location`. */
    setAvailability: (availability: SetAvailability): Promise<Availability> =>
      request('/helper/availability', { method: 'PUT', body: availability, schema: availabilitySchema }),

    /** Sent about once a minute while the helper is online. */
    reportLocation: (location: GeoPoint): Promise<void> =>
      request('/helper/location', { method: 'PUT', body: location }),

    /** The tasks this helper has been shown and can still take. */
    listNearbyTasks: (): Promise<NearbyTaskList> => request('/helper/tasks/nearby', { schema: nearbyTaskListSchema }),

    /** Takes a task at the customer's price. `outcome` says whether the job is the helper's or the customer will choose. */
    acceptTask: (taskId: string): Promise<OfferResult> =>
      request(`/helper/tasks/${taskId}/accept`, { method: 'POST', schema: offerResultSchema }),

    quoteTask: (taskId: string, price: number, etaMin?: number): Promise<OfferResult> =>
      request(`/helper/tasks/${taskId}/quote`, { method: 'POST', body: { price, etaMin }, schema: offerResultSchema }),

    declineTask: (taskId: string): Promise<void> => request(`/helper/tasks/${taskId}/decline`, { method: 'POST' }),

    // Customer: helpers' offers on a task.

    listTaskOffers: (taskId: string): Promise<TaskOfferList> =>
      request(`/tasks/${taskId}/offers`, { schema: taskOfferListSchema }),

    chooseOffer: (taskId: string, offerId: string): Promise<void> =>
      request(`/tasks/${taskId}/offers/${offerId}/accept`, { method: 'POST' }),

    /** Posts an expired task again, optionally at a higher price. */
    retryTask: (taskId: string, customerPrice?: number): Promise<Task> =>
      request(`/tasks/${taskId}/retry`, { method: 'POST', body: { customerPrice }, schema: taskSchema }),

    // Becoming a helper, and ratings.

    /** The signed-in person's helper application or profile, or null if they have never applied. */
    getHelperProfile: async (): Promise<HelperProfile | null> =>
      (await request('/helper/profile', { schema: helperProfileResponseSchema })).profile,

    applyAsHelper: (application: HelperApplication): Promise<HelperProfile> =>
      request('/helper/profile', { method: 'POST', body: application, schema: helperProfileSchema }),

    /** Uploads a document photo. On a phone pass `{ uri, name, type }`; in a browser pass a Blob or File. */
    uploadHelperDocument: (
      kind: DocumentKind,
      photo: Blob | { uri: string; name: string; type: string },
    ): Promise<HelperProfile> => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', photo as Blob, photo instanceof Blob ? 'photo' : photo.name);
      return request('/helper/documents', { method: 'POST', body: form, schema: helperProfileSchema });
    },

    /** Reports a problem with a job: either side, within the dispute window. */
    raiseDispute: (bookingId: string, reason: string): Promise<void> =>
      request(`/bookings/${bookingId}/dispute`, { method: 'POST', body: { reason } }),

    /** Rates the other side of a paid job, from 1 to 5. */
    reviewBooking: (bookingId: string, rating: number, comment?: string): Promise<void> =>
      request(`/bookings/${bookingId}/review`, { method: 'POST', body: { rating, comment } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { TokenPair };
