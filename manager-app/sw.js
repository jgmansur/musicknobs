self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'Music Knobs Manager';
  const options = {
    body: data.body || 'Tienes una nueva actualización en la app.',
    icon: data.icon || 'https://www.google.com/s2/favicons?domain=musicknobs.com&sz=192',
    badge: data.badge || 'https://www.google.com/s2/favicons?domain=musicknobs.com&sz=192',
    data: data.url || '/'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.notification.data) {
    event.waitUntil(clients.openWindow(event.notification.data));
  }
});
