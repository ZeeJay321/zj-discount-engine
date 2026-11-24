/**
 * Persistence for rules and sync events. The sync service depends on the RuleRepo
 * interface only, so tests can use an in-memory implementation.
 */
import type { PrismaClient } from "@prisma/client";
import type { CombinesWith, RuleConfig, RuleDraft } from "@zj/discount-core";

export type SyncStatus = "PENDING" | "SYNCED" | "FAILED" | "DELETING";

/** Everything Shopify needs to know about a rule; stored as `syncedConfig` once accepted. */
export interface RuleSnapshot {
  title: string;
  enabled: boolean;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  combinesWith: CombinesWith;
  config: RuleConfig;
}

export interface RuleRecord extends RuleSnapshot {
  id: string;
  shop: string;
  configVersion: number;
  shopifyDiscountId: string | null;
  syncStatus: SyncStatus;
  syncedVersion: number | null;
  syncedConfig: RuleSnapshot | null;
  syncError: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RulePatch = Partial<Omit<RuleRecord, "id" | "shop" | "createdAt" | "updatedAt">>;

export interface SyncEventInput {
  ruleId: string;
  shop: string;
  action: "create" | "update" | "delete" | "relink";
  ok: boolean;
  error?: string | null;
}

export interface RuleRepo {
  list(shop: string): Promise<RuleRecord[]>;
  get(shop: string, id: string): Promise<RuleRecord | null>;
  create(shop: string, snapshot: RuleSnapshot): Promise<RuleRecord>;
  update(shop: string, id: string, patch: RulePatch): Promise<RuleRecord>;
  remove(shop: string, id: string): Promise<void>;
  logEvent(event: SyncEventInput): Promise<void>;
  /** shop/redact: delete every rule and sync event for the shop. */
  deleteShopData(shop: string): Promise<void>;
}

export function snapshotOf(r: RuleSnapshot): RuleSnapshot {
  return {
    title: r.title,
    enabled: r.enabled,
    priority: r.priority,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    combinesWith: { ...r.combinesWith },
    config: r.config,
  };
}

export function draftToSnapshot(d: RuleDraft): RuleSnapshot {
  return snapshotOf({ ...d, title: d.title.trim() });
}

// ---------------------------------------------------------------------------
// Prisma implementation
// ---------------------------------------------------------------------------

type Row = Awaited<ReturnType<PrismaClient["rule"]["findFirstOrThrow"]>>;

function fromRow(row: Row): RuleRecord {
  return {
    id: row.id,
    shop: row.shop,
    title: row.title,
    enabled: row.enabled,
    priority: row.priority,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    combinesWith: {
      orderDiscounts: row.combinesOrder,
      productDiscounts: row.combinesProduct,
      shippingDiscounts: row.combinesShipping,
    },
    config: row.config as unknown as RuleConfig,
    configVersion: row.configVersion,
    shopifyDiscountId: row.shopifyDiscountId,
    syncStatus: row.syncStatus as SyncStatus,
    syncedVersion: row.syncedVersion,
    syncedConfig: (row.syncedConfig as unknown as RuleSnapshot | null) ?? null,
    syncError: row.syncError,
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toData(p: RulePatch) {
  const data: Record<string, unknown> = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.enabled !== undefined) data.enabled = p.enabled;
  if (p.priority !== undefined) data.priority = p.priority;
  if (p.startsAt !== undefined) data.startsAt = new Date(p.startsAt);
  if (p.endsAt !== undefined) data.endsAt = p.endsAt === null ? null : new Date(p.endsAt);
  if (p.combinesWith !== undefined) {
    data.combinesOrder = p.combinesWith.orderDiscounts;
    data.combinesProduct = p.combinesWith.productDiscounts;
    data.combinesShipping = p.combinesWith.shippingDiscounts;
  }
  if (p.config !== undefined) {
    data.config = p.config;
    data.type = p.config.type;
  }
  if (p.configVersion !== undefined) data.configVersion = p.configVersion;
  if (p.shopifyDiscountId !== undefined) data.shopifyDiscountId = p.shopifyDiscountId;
  if (p.syncStatus !== undefined) data.syncStatus = p.syncStatus;
  if (p.syncedVersion !== undefined) data.syncedVersion = p.syncedVersion;
  if (p.syncedConfig !== undefined) data.syncedConfig = p.syncedConfig === null ? null : p.syncedConfig;
  if (p.syncError !== undefined) data.syncError = p.syncError;
  if (p.syncedAt !== undefined) data.syncedAt = p.syncedAt === null ? null : new Date(p.syncedAt);
  return data;
}

export function prismaRuleRepo(prisma: PrismaClient): RuleRepo {
  return {
    async list(shop) {
      const rows = await prisma.rule.findMany({ where: { shop }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
      return rows.map(fromRow);
    },
    async get(shop, id) {
      const row = await prisma.rule.findFirst({ where: { shop, id } });
      return row ? fromRow(row) : null;
    },
    async create(shop, s) {
      const row = await prisma.rule.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { shop, syncStatus: "PENDING", configVersion: 1, ...(toData(s) as any) },
      });
      return fromRow(row);
    },
    async update(shop, id, patch) {
      const existing = await prisma.rule.findFirst({ where: { shop, id }, select: { id: true } });
      if (!existing) throw new Error("Rule not found");
      const row = await prisma.rule.update({ where: { id }, data: toData(patch) });
      return fromRow(row);
    },
    async remove(shop, id) {
      await prisma.rule.deleteMany({ where: { shop, id } });
    },
    async logEvent(e) {
      await prisma.syncEvent.create({
        data: { ruleId: e.ruleId, shop: e.shop, action: e.action, ok: e.ok, error: e.error ?? null },
      });
    },
    async deleteShopData(shop) {
      await prisma.$transaction([
        prisma.syncEvent.deleteMany({ where: { shop } }),
        prisma.rule.deleteMany({ where: { shop } }),
      ]);
    },
  };
}
