import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  accountStatusSchema,
  adminCustomerQuerySchema,
  adminDeliveryQuerySchema,
  adminStaffQuerySchema,
  assignDeliverySchema,
  createStaffSchema,
  dashboardQuerySchema,
  staffReasonSchema,
  updatePricingRuleSchema,
  type AccountStatusInput,
  type AdminCustomerQuery,
  type AdminDeliveryQuery,
  type AdminStaffQuery,
  type AssignDeliveryInput,
  type CreateStaffInput,
  type DashboardQuery,
  type StaffReasonInput,
  type UpdatePricingRuleInput,
} from "@dispatch/shared";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { RequireType } from "../auth/decorators/require-type.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AdminDashboardService } from "./admin-dashboard.service";
import { AdminDeliveriesService } from "./admin-deliveries.service";
import { AdminAccountsService } from "./admin-accounts.service";
import { AdminPricingService } from "./admin-pricing.service";
import { AdminDispatchService } from "./admin-dispatch.service";
import type { AuthPrincipal } from "../auth/auth.types";

/**
 * ADMIN COMMAND CENTRE API
 *
 * Every route is STAFF-only and permission-checked individually: reading the
 * dashboard is not the same right as assigning a delivery, editing a price or
 * suspending an account. The permission test suite drives all of it.
 */
@Controller("admin")
@RequireType("STAFF")
export class AdminOpsController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly deliveries: AdminDeliveriesService,
    private readonly accounts: AdminAccountsService,
    private readonly pricing: AdminPricingService,
    private readonly dispatchBoard: AdminDispatchService,
  ) {}

  /* ─────────────────────────── dashboard ─────────────────────────── */

  @Get("dashboard")
  @RequirePermissions("dashboard:read")
  overview(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ) {
    return this.dashboard.overview({ from: query.from, to: query.to });
  }

  /* ─────────────────────────── deliveries ────────────────────────── */

  @Get("deliveries")
  @RequirePermissions("delivery:read")
  listDeliveries(
    @Query(new ZodValidationPipe(adminDeliveryQuerySchema))
    query: AdminDeliveryQuery,
  ) {
    return this.deliveries.list({
      ...query,
      page: query.page,
      perPage: query.pageSize,
    });
  }

  /** Declared before `:id` so the literal path wins the match. */
  @Get("deliveries/export.csv")
  @RequirePermissions("delivery:export")
  async exportDeliveries(
    @Query(new ZodValidationPipe(adminDeliveryQuerySchema))
    query: AdminDeliveryQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, rows, total } = await this.deliveries.exportCsv({
      status: query.status,
      q: query.q,
      from: query.from,
      to: query.to,
    });
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deliveries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Export-Rows": String(rows),
      "X-Export-Total": String(total),
      // The file is generated per request from live data.
      "Cache-Control": "no-store",
    });
    return csv;
  }

  @Get("deliveries/:id")
  @RequirePermissions("delivery:read")
  deliveryDetail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.deliveries.detail(id);
  }

  /* ──────────────────────── dispatch board (Phase 6) ──────────────────────── */

  /**
   * What the engine is doing right now: every booking still waiting for a rider,
   * how far the search has widened, and who has already been asked.
   */
  @Get("dispatch/board")
  @RequirePermissions("delivery:read")
  dispatchBoardView() {
    return this.dispatchBoard.board();
  }

  /**
   * Run the next round immediately instead of waiting for the current batch to
   * expire. Same engine method the scheduler uses — the desk cannot bypass a rule
   * by pressing a button, it only skips the wait.
   */
  @Post("dispatch/deliveries/:id/run")
  @RequirePermissions("delivery:assign")
  runDispatchRound(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.dispatchBoard.runNow(id);
  }

  @Post("deliveries/:id/assign")
  @RequirePermissions("delivery:assign")
  assign(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(assignDeliverySchema))
    input: AssignDeliveryInput,
  ) {
    return this.deliveries.assign({
      deliveryId: id,
      riderId: input.riderId,
      reason: input.reason,
      staffId: user.staffId!,
      actorUserId: user.userId,
    });
  }

  @Post("deliveries/:id/cancel")
  @RequirePermissions("delivery:cancel")
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(staffReasonSchema)) input: StaffReasonInput,
  ) {
    return this.deliveries.cancel({
      deliveryId: id,
      reason: input.reason,
      staffId: user.staffId!,
      actorUserId: user.userId,
    });
  }

  /* ─────────────────────────── customers ─────────────────────────── */

  @Get("customers")
  @RequirePermissions("customer:read")
  listCustomers(
    @Query(new ZodValidationPipe(adminCustomerQuerySchema))
    query: AdminCustomerQuery,
  ) {
    return this.accounts.listCustomers({ ...query, perPage: query.pageSize });
  }

  @Post("customers/:id/status")
  @RequirePermissions("customer:suspend")
  setCustomerStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(accountStatusSchema)) input: AccountStatusInput,
  ) {
    return this.accounts.setCustomerStatus({
      customerId: id,
      status: input.status,
      reason: input.reason,
      staffId: user.staffId!,
      actorUserId: user.userId,
    });
  }

  /* ───────────────────────────── staff ───────────────────────────── */

  @Get("team")
  @RequirePermissions("staff:read")
  listTeam(
    @Query(new ZodValidationPipe(adminStaffQuerySchema)) query: AdminStaffQuery,
  ) {
    return this.accounts.listStaff({ ...query, perPage: query.pageSize });
  }

  @Get("roles")
  @RequirePermissions("staff:read")
  listRoles() {
    return this.accounts.listRoles();
  }

  @Post("team")
  @RequirePermissions("staff:write")
  createStaff(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createStaffSchema)) input: CreateStaffInput,
  ) {
    return this.accounts.createStaff({
      ...input,
      staffId: user.staffId!,
      actorUserId: user.userId,
    });
  }

  @Post("team/:id/status")
  @RequirePermissions("staff:write")
  setStaffStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(accountStatusSchema)) input: AccountStatusInput,
  ) {
    return this.accounts.setStaffStatus({
      staffId: id,
      status: input.status,
      reason: input.reason,
      actingStaffId: user.staffId!,
      actorUserId: user.userId,
    });
  }

  /* ──────────────────────────── pricing ──────────────────────────── */

  @Get("pricing")
  @RequirePermissions("pricing:read")
  pricingOverview() {
    return this.pricing.list();
  }

  @Post("pricing/rules/:id")
  @RequirePermissions("pricing:write")
  updateRule(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updatePricingRuleSchema))
    input: UpdatePricingRuleInput,
  ) {
    return this.pricing.updateRule({
      ruleId: id,
      changes: input,
      staffId: user.staffId!,
      actorUserId: user.userId,
    });
  }
}
