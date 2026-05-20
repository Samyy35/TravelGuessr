// Service Worker TravelGuesser — gère les push notifications
// Version : 1.0

self.addEventListener('install', (event) => {
  // Skip waiting pour activer immédiatement
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Prendre le contrôle immédiat de tous les clients
  event.waitUntil(self.clients.claim());
});

// Réception d'une push notification
self.addEventListener('push', (event) => {
  let payload = { title: 'TravelGuesser', body: 'Quelqu\'un a fait un sans-faute !', icon: '/icon-192.png' };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body || 'Quelqu\'un vient de faire un sans-faute',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: payload.data || {},
    tag: payload.tag || 'travelguesser-perfect',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'TravelGuesser', options)
  );
});

// Clic sur la notif : ouvre l'app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      // Si une fenêtre est ouverte → focus
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      // Sinon → ouvre une nouvelle
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
