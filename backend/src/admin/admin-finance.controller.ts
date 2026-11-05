import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { RequireType } from "../auth/decorators/require-type.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AppConfig } from "../config/app.config";
import { AdminFinanceService } from "./admin-finance.service";
import { RefundsService } from "../payments/refunds.service";
import { WithdrawalsService } from "../withdrawals/withdrawals.service";
import type { AuthPrincipal } from "../auth/auth.types";

const listSchema = z.object({
  status: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const periodSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const refundSchema = z.object({
  amountKobo: z.coerce.bigint().positive("Enter the amount to refund"),
  reason: z.string().trim().min(3, "Say why this refund is being issued").max(200),
  note: z.string().trim().max(500).optional(),
});
const decisionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
const rejectSchema = z.object({
  note: z.string().trim().min(3, "Explain why this withdrawal is being rejected").max(500),
});

/**
 * FINANCE CONTROLLER
 *
 * Permissions are the point of this file: reading money needs `finance:read`,
 * refunding needs `finance:refund:write`, approving a withdrawal needs
 * `withdrawal:approve` and actually paying it needs `withdrawal:payout`.
 * A support agent holds none of these and cannot move a kobo.
 */
@Controller("admin/finance")
@RequireType("STAFF")
export class AdminFinanceController {
  constructor(
    private readonly finance: AdminFinanceService,
    private readonly refunds: RefundsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly config: AppConfig,
  ) {}

  @Get("summary")
  @RequirePermissions("finance:read")
  summary(@Query(new ZodValidationPipe(periodSchema)) query: z.infer<typeof periodSchema>) {
    return this.finance.summary(
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get("payments")
  @RequirePermissions("finance:read")
  payments(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.finance.payments(query.status, query.page, query.pageSize);
  }

  @Get("reconciliation")
  @RequirePermissions("ledger:read")
  reconciliation() {
    return this.finance.reconciliation();
  }

  @Get("refunds")
  @RequirePermissions("finance:read")
  refundsList(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.refunds.list(query.status, query.page, query.pageSize);
  }

  @Post("payments/:paymentId/refunds")
  @RequirePermissions("finance:refund:write")
  refund(
    @CurrentUser() user: AuthPrincipal,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body(new ZodValidationPipe(refundSchema)) body: z.infer<typeof refundSchema>,
  ) {
    return this.refunds.create(user.staffId ?? user.userId, {
      paymentId,
      amountKobo: body.amountKobo,
      reason: body.reason,
      note: body.note,
    });
  }

  @Get("withdrawals")
  @RequirePermissions("withdrawal:read")
  withdrawalsList(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.withdrawals.listForStaff(query.status, query.page, query.pageSize);
  }

  @Post("withdrawals/:id/approve")
  @RequirePermissions("withdrawal:approve")
  approve(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>,
  ) {
    return this.withdrawals.approve(id, user.staffId ?? user.userId, body.note ?? null);
  }

  @Post("withdrawals/:id/reject")
  @RequirePermissions("withdrawal:approve")
  reject(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    return this.withdrawals.reject(id, user.staffId ?? user.userId, body.note);
  }

  @Post("withdrawals/:id/payout")
  @RequirePermissions("withdrawal:payout")
  payout(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.withdrawals.payout(id, user.staffId ?? user.userId);
  }
}
