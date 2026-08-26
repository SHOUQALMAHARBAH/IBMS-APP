import { Global, Module } from '@nestjs/common';
import { WorkflowTransitionService } from './workflow-transition.service';

@Global()
@Module({
  providers: [WorkflowTransitionService],
  exports: [WorkflowTransitionService],
})
export class WorkflowModule {}
