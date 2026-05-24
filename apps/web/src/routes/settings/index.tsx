import { redirect } from '@tanstack/react-router';

/** /settings → redirect to /settings/profile */
export const settingsIndexBeforeLoad = () => {
  throw redirect({ to: '/settings/profile' });
};
