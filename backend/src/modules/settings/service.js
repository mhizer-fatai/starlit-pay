// A user's preferences. Every account reads a full set: the defaults, then
// whatever the user changed. An update touches only the fields it names.

export const DEFAULT_SETTINGS = {
  language: "en",
  currency: "USD",
  notif_email: true,
  notif_push: true,
  notif_sms: false,
  notif_marketing: false,
  sec_passkey: true,
  sec_google: true,
  sec_email: true,
  sec_phone: false,
  sec_password: true,
};

export function createSettingsService({ repository, now = () => new Date() }) {
  return {
    async get(userId) {
      return (await repository.find(userId)) ?? (await repository.save({ user_id: userId, ...DEFAULT_SETTINGS }));
    },

    async update(userId, changes) {
      const existing = await repository.find(userId);
      const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
      return repository.save({ user_id: userId, ...DEFAULT_SETTINGS, ...existing, ...defined, updated_at: now().toISOString() });
    },
  };
}
