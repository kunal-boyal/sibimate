import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, type Tokens, createApiClient } from './index.js';

const user = {
  id: '4845ba0e-2084-4f75-9837-72b79755b173',
  phone: '+919876543210',
  name: null,
  language: 'en',
  roles: ['customer'],
  status: 'active',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(responses: Response[]) {
  let tokens: Tokens | null = {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  };
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => responses.shift()!);
  const onTokens = vi.fn((next: Tokens | null) => {
    tokens = next;
  });
  const client = createApiClient({
    baseUrl: 'http://api.test/v1',
    deviceId: () => 'device-1234',
    getTokens: () => tokens,
    onTokens,
    fetch: fetchMock as typeof fetch,
  });
  const auth = (call: number) => (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).Authorization;
  return { client, fetchMock, onTokens, auth };
}

describe('api client', () => {
  it('sends the device id with an OTP request and no token', async () => {
    const { client, fetchMock, auth } = setup([json(200, { expiresIn: 300, resendIn: 30 })]);
    await expect(client.requestOtp('9876543210')).resolves.toEqual({
      expiresIn: 300,
      resendIn: 30,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/v1/auth/otp/request');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      phone: '9876543210',
      deviceId: 'device-1234',
    });
    expect(auth(0)).toBeUndefined();
  });

  it('turns an error body into an ApiClientError with its code', async () => {
    const { client } = setup([json(400, { code: 'otp_invalid', message: 'That code is not correct.' })]);
    await expect(client.verifyOtp('9876543210', '000000')).rejects.toMatchObject({ code: 'otp_invalid', status: 400 });
  });

  it('reports an unreachable API as a network error', async () => {
    const { client, fetchMock } = setup([]);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(client.getMe()).rejects.toMatchObject({ code: 'network' });
  });

  it('refreshes once on a 401 and repeats the request with the new token', async () => {
    const { client, onTokens, auth } = setup([
      json(401, { code: 'unauthorized', message: 'Unauthorized' }),
      json(200, {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      }),
      json(200, user),
    ]);
    await expect(client.getMe()).resolves.toEqual(user);
    expect(onTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(auth(0)).toBe('Bearer old-access');
    expect(auth(2)).toBe('Bearer new-access');
  });

  it('shares one refresh between requests that fail together', async () => {
    const unauthorized = () => json(401, { code: 'unauthorized', message: 'Unauthorized' });
    const { client, fetchMock } = setup([
      unauthorized(),
      unauthorized(),
      json(200, {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      }),
      json(200, user),
      json(200, user),
    ]);
    await Promise.all([client.getMe(), client.getMe()]);
    const refreshes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('ends the session when the refresh token is refused', async () => {
    const { client, onTokens } = setup([
      json(401, { code: 'unauthorized', message: 'Unauthorized' }),
      json(401, { code: 'unauthorized', message: 'Unauthorized' }),
    ]);
    await expect(client.getMe()).rejects.toBeInstanceOf(ApiClientError);
    expect(onTokens).toHaveBeenCalledWith(null);
  });

  it('sends the idempotency key when posting a task, again after a refresh', async () => {
    const task = {
      id: '4845ba0e-2084-4f75-9837-72b79755b173',
      title: 'Carry two suitcases',
      description: 'Carry two suitcases from the station.',
      category: null,
      requiresSkilled: false,
      helpersNeeded: 1,
      customerPrice: 15000,
      paymentMethod: 'cash',
      scheduleAt: null,
      status: 'matching',
      address: '14 Shanti Path',
      pickup: { lat: 26.85, lng: 75.76 },
      booking: null,
      createdAt: '2026-11-20T10:00:00.000Z',
    };
    const { client, fetchMock } = setup([
      json(401, { code: 'unauthorized', message: 'Unauthorized' }),
      json(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
      json(201, task),
    ]);
    const body = {
      title: task.title,
      description: task.description,
      requiresSkilled: false,
      customerPrice: 15000,
      pickup: { lat: 26.85, lng: 75.76 },
      address: task.address,
      paymentMethod: 'cash' as const,
    };
    await expect(client.createTask(body, 'key-12345678')).resolves.toEqual(task);
    const keys = [0, 2].map(
      (call) => (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(keys).toEqual(['key-12345678', 'key-12345678']);
  });

  it('uploads a recording as form data, without forcing a JSON content type', async () => {
    const interpretation = {
      id: '4845ba0e-2084-4f75-9837-72b79755b173',
      inputText: 'carry two suitcases',
      title: 'Carry two suitcases',
      description: 'Carry two suitcases from the station.',
      category: { slug: 'carry-luggage', name: 'Carrying and luggage', provisional: false },
      requiresSkilled: false,
      helpersNeeded: 1,
      estimatedMinutes: { min: 30, max: 45 },
      requirements: [],
      followUpQuestion: null,
    };
    const { client, fetchMock } = setup([json(200, interpretation)]);
    await expect(client.interpretVoice(new Blob(['audio'], { type: 'audio/webm' }))).resolves.toEqual(interpretation);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect(((init.body as FormData).get('audio') as File).name).toBe('task.webm');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
