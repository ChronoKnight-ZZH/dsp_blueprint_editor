import type { RequestHandler } from "express";
import { z } from "zod";
import { loadOrders } from "../../service/order";
import { pickTenantHeaders } from "../../shared/http";

const listQuerySchema = z.object({
  status: z.enum(["open", "paid", "shipped", "closed"]).optional(),
  keyword: z.string().trim().min(1).optional(),
  customerId: z.string().cuid().optional(),
});

export interface ListOrdersCtx {
  readonly userId: string;
  readonly tenantId: string;
  readonly traceId: string;
}

/**
 * 订单列表处理器
 * 现状：一次性返回全部匹配记录，无分页、无上限保护。
 */
export const listOrdersHandler: RequestHandler = async (req, res, next) => {
  const ctx: ListOrdersCtx = {
    userId: req.user?.id ?? "",
    tenantId: req.user?.tenantId ?? "",
    traceId: req.requestId ?? "",
  };

  try {
    const query = listQuerySchema.parse(req.query);
    const rows = await loadOrders(ctx, query);

    if (rows.length === 0) {
      res.status(200).json({ items: [], total: 0 });
      return;
    }

    const items = rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      amount: row.amountCents / 100,
      createdAt: row.createdAt.toISOString(),
    }));

    res.status(200).json({ items, total: items.length });
  } catch (err) {
    pickTenantHeaders(req);
    next(err);
  }
};
