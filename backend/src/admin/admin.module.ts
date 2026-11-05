import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DispatchModule } from "../dispatch/dispatch.module";
import { AdminController } from "./admin.controller";
import { AdminOpsController } from "./admin-ops.controller";
import { AdminService } from "./admin.service";
import { AdminDashboardService } from "./admin-dashboard.service";
import { AdminDeliveriesService } from "./admin-deliveries.service";
import { AdminAccountsService } from "./admin-accounts.service";
import { AdminPricingService } from "./admin-pricing.service";
import { AdminDispatchService } from "./admin-dispatch.service";
import { AdminFinanceController } from "./admin-finance.controller";
import { AdminFinanceService } from "./admin-finance.service";
import { PaymentsModule } from "../payments/payments.module";
import { WithdrawalsModule } from "../withdrawals/withdrawals.module";

@Module({
  // TokenService revokes a suspended user's refresh tokens; PasswordService hashes
  // the temporary password when an admin creates a staff account.
  // DispatchService is the engine itself — the board runs the same rounds it does.
  // PaymentsModule brings the refund service; WithdrawalsModule the approval and
  // payout workflow. Both post to the ledger, which is global.
  imports: [AuthModule, DispatchModule, PaymentsModule, WithdrawalsModule],
  controllers: [AdminController, AdminOpsController, AdminFinanceController],
  providers: [
    AdminService,
    AdminDashboardService,
    AdminDeliveriesService,
    AdminAccountsService,
    AdminPricingService,
    AdminDispatchService,
    AdminFinanceService,
  ],
})
export class AdminModule {}
