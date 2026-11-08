import type { RequestHandler } from "express";
import { z } from "zod";
import { fetchOrderList } from "../../service/order";
import { pickTenantHeaders } from "../../shared/http";

const listQuerySchema = z.object({
  state: z.enum(["open", "paid", "shipped", "closed", "refunding"]).optional(),
  keyword: z.string().trim().min(1).optional(),
  customerId: z.string().cuid().optional(),
});

export interface ListOrdersCtx {
  readonly userId: string;
  readonly tenantId: string;
  readonly traceId: string;
  readonly locale: string;
}

/**
 * 订单列表处理器（已重构：改为游标分页 + locale 注入）
 * 现状：返回结构已变为 { data, nextCursor }，不再是 { items, total }。
 */
export const fetchOrderListHandler: RequestHandler = async (req, res, next) => {
  const ctx: ListOrdersCtx = {
    userId: req.user?.id ?? "",
    tenantId: req.user?.tenantId ?? "",
    traceId: req.requestId ?? "",
    locale: req.headers["accept-language"]?.toString().slice(0, 5) ?? "en",
  };

  try {
    const query = listQuerySchema.parse(req.query);
    const page = await fetchOrderList(ctx, query, {
      cursor: req.query.cursor?.toString(),
      take: 50,
    });

    const items = page.rows.map((row) => ({
      id: row.id,
      code: row.orderNo,
      status: row.state,
      amount: row.amount / 100,
      createdAt: new Date(row.created).toISOString(),
    }));

    res.status(200).json({ data: items, nextCursor: page.nextCursor });
  } catch (err) {
    pickTenantHeaders(req);
    next(err);
  }
};
