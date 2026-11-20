import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { queryClient } from './query';
import { api, useSession } from './session';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

/**
 * Keeps a live connection to the API while someone is signed in. Events only
 * say that something changed: the screens then fetch fresh data, so what is
 * shown always comes from the API itself. Screens also check on a slow timer,
 * which covers the moments the connection is down.
 */
export function useLiveUpdates(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const socket = io(new URL(API_URL).origin, {
      transports: ['websocket'],
      // Read at each attempt, so a reconnect uses the newest access token.
      auth: (send) => send({ token: useSession.getState().tokens?.accessToken }),
    });

    socket.on('task.changed', () => {
      for (const key of ['tasks', 'jobs', 'nearby']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    });
    // A helper application was approved or turned down.
    socket.on('profile.changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['helperProfile'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    });
    socket.on('helper.location', ({ taskId, lat, lng }: { taskId: string; lat: number; lng: number }) => {
      queryClient.setQueryData(['helperLocation', taskId], { lat, lng });
    });
    // The server drops a connection whose token has expired. Any API call renews the token; then try again.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          void api
            .getMe()
            .then(() => socket.connect())
            .catch(() => undefined);
        }, 3000);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [signedIn]);
}
