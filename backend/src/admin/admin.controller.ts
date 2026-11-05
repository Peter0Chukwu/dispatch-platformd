import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { RequireType } from "../auth/decorators/require-type.decorator";
import { ZodQuery } from "../common/decorators/zod.decorators";
import { paginationSchema } from "@dispatch/shared";
import { AdminService } from "./admin.service";
import type { AuthPrincipal } from "../auth/auth.types";

/**
 * ADMIN PORTAL API SURFACE (Phase 2 slice)
 *
 * Every route here requires a STAFF account AND a specific permission. The
 * dashboard, delivery, finance and rider screens arrive in Phase 5; what exists
 * now is the authenticated shell plus the pieces needed to prove RBAC works.
 */
const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
});

@Controller("admin")
@RequireType("STAFF")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Who am I, what may I do — the source of truth for the admin UI's navigation. */
  @Get("whoami")
  @RequirePermissions("dashboard:read")
  whoami(@CurrentUser() user: AuthPrincipal) {
    return this.admin.whoami(user);
  }

  /** Staff directory. A SUPPORT_AGENT does not hold `staff:read` and gets 403. */
  @Get("staff")
  @RequirePermissions("staff:read")
  listStaff(
    @ZodQuery(paginationSchema) query: z.infer<typeof paginationSchema>,
  ) {
    return this.admin.listStaff(query);
  }

  /** Permission catalogue for the role editor (Phase 5). */
  @Get("permissions")
  @RequirePermissions("role:write")
  listPermissions() {
    return this.admin.listPermissions();
  }

  /** Audit trail — who did what, when. Filterable by action and entity. */
  @Get("audit-logs")
  @RequirePermissions("audit:read")
  auditLogs(
    @ZodQuery(auditQuerySchema) query: z.infer<typeof auditQuerySchema>,
  ) {
    return this.admin.listAuditLogs(query);
  }
}
