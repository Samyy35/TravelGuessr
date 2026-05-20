// Endpoint /api/notify-perfect
// Appelé quand un joueur fait un sans-faute (3/3) dans un serveur
// Envoie une push notif à tous les autres joueurs du serveur

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@travelguesser.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(500).json({ error: 'VAPID keys not configured' });
  }

  try {
    const { server_id, profile_id, player_name, player_avatar, callsign, airline, model, to_city } = req.body || {};
    if (!server_id || !profile_id) {
      return res.status(400).json({ error: 'server_id and profile_id required' });
    }

    // Récupérer les autres membres du serveur
    const { data: members, error: errMembers } = await supabase
      .from('server_members')
      .select('profile_id')
      .eq('server_id', server_id)
      .neq('profile_id', profile_id);

    if (errMembers) throw errMembers;
    if (!members || members.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No other members' });
    }

    const otherProfileIds = members.map(m => m.profile_id);

    // Récupérer les subscriptions push de ces joueurs
    const { data: subs, error: errSubs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, profile_id')
      .in('profile_id', otherProfileIds);

    if (errSubs) throw errSubs;
    if (!subs || subs.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No subscriptions' });
    }

    // Construire le message
    const title = `✈️ Sans-faute de ${player_name || 'un joueur'} !`;
    const bodyParts = [];
    if (model) bodyParts.push(model);
    if (airline) bodyParts.push(airline);
    if (to_city) bodyParts.push(`→ ${to_city}`);
    const body = bodyParts.length > 0
      ? `${player_avatar || '🛩'} ${bodyParts.join(' · ')}`
      : 'Quelqu\'un vient de faire 3/3 sur ton serveur';

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      tag: `perfect-${callsign || Date.now()}`,
      data: { server_id, callsign }
    });

    // Envoyer en parallèle, gérer les erreurs gracieusement
    const results = await Promise.allSettled(
      subs.map(sub => webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload).catch(err => {
        // 410 = subscription expired, supprimer
        if (err.statusCode === 410 || err.statusCode === 404) {
          return supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        throw err;
      }))
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return res.status(200).json({ sent, failed, total: subs.length });

  } catch (e) {
    console.error('notify-perfect error:', e);
    return res.status(500).json({ error: e.message });
  }
}
