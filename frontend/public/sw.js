const CACHE_NAME = "starlit-pay-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/favicon.png",
  "/manifest.json"
];

// Handles service worker installation and pre-caches static resources
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Cleans up outdated caches on service worker activation
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercepts fetch requests (bypasses cache completely)
self.addEventListener("fetch", (event) => {
  return;
});

// Listens for push notification events and triggers native system display alerts
self.addEventListener("push", (event) => {
  let title = "Starlit Pay Notification";
  let options = {
    body: "You have a new update from Starlit Pay.",
    icon: "/favicon.png",
    badge: "/favicon.png"
  };

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      options = {
        body: data.body || options.body,
        icon: data.icon || options.icon,
        badge: data.badge || options.badge,
        data: data.data
      };
    } catch (e) {
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});
