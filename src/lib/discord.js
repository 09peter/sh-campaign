// Discord webhook dispatch. Fire-and-forget; failures never block app flow.

const COLORS = { red: 0xa62b21, brass: 0xc0983e, olive: 0x4c5238 };

async function send(url, embed) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Sledgehammer Vox-Caster', embeds: [embed] }),
    });
  } catch (e) {
    console.warn('Discord webhook failed', e);
  }
}

export const notifyBattleReported = (url, { attacker, defender, mission, result, notes }) =>
  send(url, {
    title: '⚔️ Battle report filed',
    color: COLORS.red,
    description: `**${attacker}** engaged **${defender}**${mission ? ` — *${mission}*` : ''}.`,
    fields: [
      { name: 'Result', value: result ?? 'Pending', inline: true },
      ...(notes ? [{ name: 'From the front', value: notes.slice(0, 900) }] : []),
    ],
    footer: { text: 'The Emperor expects verification from the opposing commander.' },
  });

export const notifyBattleVerified = (url, { attacker, defender, result, xpSummary }) =>
  send(url, {
    title: '✅ Battle verified — records updated',
    color: COLORS.brass,
    description: `**${attacker}** vs **${defender}** — ${result}.`,
    fields: xpSummary ? [{ name: 'Experience awarded', value: xpSummary.slice(0, 900) }] : [],
  });

export const notifyDispute = (url, { attacker, defender, reason }) =>
  send(url, {
    title: '⚠️ Dispute raised — GM adjudication required',
    color: COLORS.red,
    description: `**${attacker}** vs **${defender}**`,
    fields: [{ name: 'Grounds', value: reason || 'None given' }],
  });

export const notifyRosterApproved = (url, { player, faction, roster }) =>
  send(url, {
    title: '📜 Order of Battle sanctioned',
    color: COLORS.brass,
    description: `**${player}** marches to war with **${roster}**${faction ? ` (${faction})` : ''}.`,
  });

export const notifyTurnAdvanced = (url, { turn, conflicts }) =>
  send(url, {
    title: `🗺️ Campaign turn ${turn} — orders locked`,
    color: COLORS.olive,
    description: conflicts.length
      ? `**${conflicts.length} engagement(s)** declared:\n` +
        conflicts.map((c) => `• ${c}`).join('\n').slice(0, 1500)
      : 'No contact with the enemy. Redeployment proceeds unopposed.',
  });

export const notifyCampaignCompleted = (url, { winner, standings }) =>
  send(url, {
    title: '🏆 Campaign concluded',
    color: COLORS.brass,
    description: `Victory: **${winner}**\n\n${standings.slice(0, 1500)}`,
  });
