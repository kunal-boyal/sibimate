import { ApiClientError, type Tokens, createApiClient } from '@sibimate/api-client';
import { LANGUAGES, type Language, type OtpVerifyResponse, type User } from '@sibimate/shared';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { queryClient } from './query';
import { storage } from './storage';

const KEYS = {
  deviceId: 'sibimate.deviceId',
  language: 'sibimate.language',
  session: 'sibimate.session',
};

interface SessionState {
  /** `loading` until the stored session has been read. */
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  tokens: Tokens | null;
  deviceId: string;
  language: Language;
  restore: () => Promise<void>;
  signIn: (response: OtpVerifyResponse) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

function persist(tokens: Tokens | null, user: User | null) {
  return tokens && user ? storage.set(KEYS.session, JSON.stringify({ tokens, user })) : storage.remove(KEYS.session);
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  tokens: null,
  deviceId: '',
  language: 'en',

  async restore() {
    let deviceId = await storage.get(KEYS.deviceId);
    if (!deviceId) {
      deviceId = Crypto.randomUUID();
      await storage.set(KEYS.deviceId, deviceId);
    }
    const storedLanguage = await storage.get(KEYS.language);
    const language = LANGUAGES.find((l) => l === storedLanguage) ?? 'en';

    let saved: { tokens: Tokens; user: User } | null = null;
    try {
      saved = JSON.parse((await storage.get(KEYS.session)) ?? 'null');
    } catch {
      // A damaged entry is treated as signed out.
    }
    if (!saved) {
      set({ deviceId, language, status: 'signedOut' });
      return;
    }
    set({
      deviceId,
      language,
      tokens: saved.tokens,
      user: saved.user,
      status: 'signedIn',
    });

    // Open on the saved profile at once, then check it. A refused token signs out through onTokens.
    api
      .getMe()
      .then((user) => {
        if (get().status === 'signedIn') {
          set({ user });
          return persist(get().tokens, user);
        }
      })
      .catch(() => undefined);
  },

  async signIn({ accessToken, refreshToken, user, isNewUser }) {
    const tokens = { accessToken, refreshToken };
    const chosen = get().language;
    set({ tokens, user, status: 'signedIn' });
    await persist(tokens, user);

    if (isNewUser && user.language !== chosen) {
      // A new account takes the language picked on the welcome screen.
      api
        .updateMe({ language: chosen })
        .then((updated) => set({ user: updated }))
        .catch(() => undefined);
    } else if (!isNewUser && user.language !== chosen) {
      // A returning customer gets the language saved on their account.
      set({ language: user.language });
      await storage.set(KEYS.language, user.language);
    }
  },

  async signOut() {
    const refreshToken = get().tokens?.refreshToken;
    set({ tokens: null, user: null, status: 'signedOut' });
    // The next person to sign in on this phone must not see this account's tasks.
    queryClient.clear();
    await persist(null, null);
    if (refreshToken) {
      await api.logout(refreshToken).catch(() => undefined);
    }
  },

  async setLanguage(language) {
    set({ language });
    await storage.set(KEYS.language, language);
    if (get().status === 'signedIn') {
      api
        .updateMe({ language })
        .then((user) => set({ user }))
        .catch(() => undefined);
    }
  },
}));

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1',
  deviceId: () => useSession.getState().deviceId,
  getTokens: () => useSession.getState().tokens,
  onTokens: (tokens) => {
    const { user } = useSession.getState();
    useSession.setState(tokens ? { tokens } : { tokens: null, user: null, status: 'signedOut' });
    void persist(tokens, tokens ? user : null);
  },
});

export { ApiClientError };
