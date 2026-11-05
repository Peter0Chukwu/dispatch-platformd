import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ReportDatasetsService } from './report-datasets.service';
import { ReportsService } from './reports.service';
import { ReportsScheduler } from './reports.scheduler';
import { ReportDownloadController, ReportsController } from './reports.controller';

/**
 * Reports and analytics (Phase 9).
 *
 * Datasets → one table shape → two renderings (CSV, PDF) → private storage → a
 * signed, expiring download. The worker is a table-backed queue, so a restart
 * never loses a request.
 */
@Module({
  imports: [StorageModule],
  controllers: [ReportsController, ReportDownloadController],
  providers: [ReportDatasetsService, ReportsService, ReportsScheduler],
  exports: [ReportsService, ReportDatasetsService],
})
export class ReportsModule {}
