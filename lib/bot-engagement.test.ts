import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyClickEvents,
  clusterClicks,
  isBotCluster,
  sendHasHumanClick,
  sendHasHumanOpen,
} from "@/lib/bot-engagement";
import { sendIsBotOnlyOpen } from "@/lib/bot-open";

const HOUR_MS = 3_600_000;

test("clusterClicks splits sessions on gaps greater than 5s", () => {
  const base = new Date("2026-01-01T10:00:00.000Z");
  const clusters = clusterClicks([
    { url: "https://a.example/1", at: new Date(base.getTime() + 0) },
    { url: "https://a.example/2", at: new Date(base.getTime() + 2_000) },
    { url: "https://a.example/3", at: new Date(base.getTime() + HOUR_MS) },
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].length, 2);
  assert.equal(clusters[1].length, 1);
});

test("scan burst then human click counts as human open and human click", () => {
  const sentAt = new Date("2026-01-01T09:00:00.000Z");
  const scanAt = new Date(sentAt.getTime() + 35_000);
  const humanAt = new Date(sentAt.getTime() + 2 * HOUR_MS);

  const send = {
    sentAt,
    openedAt: scanAt,
    openEvents: [
      { at: scanAt, bot: true },
      { at: humanAt },
    ],
    clickEvents: [
      { url: "https://track.example/l/1", at: new Date(scanAt.getTime() + 0) },
      { url: "https://track.example/l/2", at: new Date(scanAt.getTime() + 500) },
      { url: "https://track.example/l/3", at: new Date(scanAt.getTime() + 1_000) },
      { url: "https://track.example/l/4", at: new Date(scanAt.getTime() + 1_500) },
      { url: "https://track.example/l/5", at: new Date(scanAt.getTime() + 2_000) },
      { url: "https://track.example/l/6", at: new Date(scanAt.getTime() + 2_500) },
      { url: "https://track.example/l/7", at: new Date(scanAt.getTime() + 3_000) },
      { url: "https://track.example/l/8", at: new Date(scanAt.getTime() + 3_500) },
      { url: "https://track.example/cta", at: humanAt },
    ],
    botClick: true,
  };

  const classification = classifyClickEvents(send);
  const scanEvents = classification.filter((row) => row.event.url?.includes("/l/"));
  const human = classification.find((row) => row.event.url?.includes("/cta"));

  assert.equal(scanEvents.length, 8);
  assert.ok(scanEvents.every((row) => row.isBot));
  assert.ok(human);
  assert.equal(human?.isBot, false);

  assert.equal(sendHasHumanClick(send), true);
  assert.equal(sendHasHumanOpen(send), true);
  assert.equal(sendIsBotOnlyOpen(send), false);
});

test("isBotCluster flags multi-link burst inside one session", () => {
  const sentAt = new Date("2026-01-01T09:00:00.000Z");
  const t0 = new Date(sentAt.getTime() + 60_000);
  const cluster = [
    { url: "https://a.example/1", at: t0 },
    { url: "https://a.example/2", at: new Date(t0.getTime() + 1_000) },
  ];
  assert.equal(isBotCluster(cluster, { sentAt }, cluster), true);
});

test("honeypot click is bot; later single human click in new cluster is not", () => {
  const sentAt = new Date("2026-01-01T09:00:00.000Z");
  const trapAt = new Date(sentAt.getTime() + 40_000);
  const humanAt = new Date(sentAt.getTime() + HOUR_MS);
  const send = {
    sentAt,
    clickEvents: [
      { url: "https://track.example/nxs-click-trap", at: trapAt },
      { url: "https://track.example/cta", at: humanAt },
    ],
  };
  const rows = classifyClickEvents(send);
  const trap = rows.find((row) => row.event.url?.includes("nxs-click-trap"));
  const human = rows.find((row) => row.event.url?.includes("/cta"));
  assert.equal(trap?.isBot, true);
  assert.equal(human?.isBot, false);
  assert.equal(sendHasHumanClick(send), true);
});
