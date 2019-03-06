import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { PersistenceService } from '../../core/persistence/persistence.service';
import { ProjectService } from '../project/project.service';
import { expandFadeAnimation } from '../../ui/animations/expand.ani';
import { mapArchiveToWorklog, Worklog, WorklogDay, WorklogMonth } from './map-archive-to-worklog';
import { MatDialog } from '@angular/material';
import { Subscription } from 'rxjs';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { EntityState } from '@ngrx/entity';
import { dedupeByKey } from '../../util/de-dupe-by-key';
import { WeeksInMonth } from '../../util/get-weeks-in-month';
import { DialogWorklogExportComponent } from './dialog-worklog-export/dialog-worklog-export.component';
import { DialogTaskSummaryComponent } from './dialog-task-summary/dialog-task-summary.component';

const EMPTY_ENTITY = {
  ids: [],
  entities: {},
};


@Component({
  selector: 'worklog',
  templateUrl: './worklog.component.html',
  styleUrls: ['./worklog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation]
})
export class WorklogComponent implements OnInit, OnDestroy {
  worklog: Worklog = {};
  totalTimeSpent: number;
  private _projectId: string;
  private _isUnloaded = false;
  private _subs = new Subscription();

  constructor(
    private readonly _persistenceService: PersistenceService,
    private readonly _projectService: ProjectService,
    private readonly _taskService: TaskService,
    private readonly _matDialog: MatDialog,
    private readonly _cd: ChangeDetectorRef,
  ) {
  }

  ngOnInit() {
    this._subs.add(this._projectService.currentId$.subscribe((id) => {
      this._projectId = id;
      this._loadData(id);
    }));
  }

  ngOnDestroy(): void {
    // TODO better solution
    this._isUnloaded = true;
    this._subs.unsubscribe();
  }

  exportData(monthData: WorklogMonth, year: number, month_: string | number, week?: WeeksInMonth) {
    let rangeStart;
    let rangeEnd;
    // denormalize to js month again
    const month = +month_ - 1;
    if (!week) {
      // firstDayOfMonth
      rangeStart = new Date(year, month, 1);
      // lastDayOfMonth
      rangeEnd = new Date(year, month + 1, 0);
    } else {
      // startOfWeek
      rangeStart = new Date(year, month, week.start);
      // endOfWeek
      rangeEnd = new Date(year, month, week.end);
    }

    rangeEnd.setHours(23, 59, 59);

    this._matDialog.open(DialogWorklogExportComponent, {
      restoreFocus: true,
      panelClass: 'big',
      data: {
        tasks: this._createTasksForMonth(monthData),
        isWorklogExport: true,
        rangeStart,
        rangeEnd,
      }
    });
  }

  openTaskSummaryForDay(worklogForDay: { key: string; value: WorklogDay }) {
    this._matDialog.open(DialogTaskSummaryComponent, {
      restoreFocus: true,
      data: {
        worklogForDay,
      }
    });
  }


  sortWorklogItems(a, b) {
    return b.key - a.key;
  }

  sortWorklogItemsReverse(a, b) {
    return a.key - b.key;
  }

  private async _loadData(projectId): Promise<any> {
    const archive = await this._persistenceService.loadTaskArchiveForProject(projectId) || EMPTY_ENTITY;
    const taskState = await this._persistenceService.loadTasksForProject(projectId) || EMPTY_ENTITY;

    const completeState: EntityState<Task> = {
      ids: [...archive.ids, ...taskState.ids] as string[],
      entities: {
        ...archive.entities,
        ...taskState.entities
      }
    };

    if (this._isUnloaded) {
      return;
    }

    if (completeState) {
      const {worklog, totalTimeSpent} = mapArchiveToWorklog(completeState, taskState.ids);
      this.worklog = worklog;
      this.totalTimeSpent = totalTimeSpent;
      this._cd.detectChanges();
    } else {
      this.worklog = {};
      this.totalTimeSpent = null;
      this._cd.detectChanges();
    }
    // console.log(this.worklog);
    // this.exportData(this.worklog[2019].ent[3], 2019, 3);
  }

  private _createTasksForDay(data: WorklogDay) {
    const tasks = [];
    const dayData = {...data};

    dayData.logEntries.forEach((entry) => {
      const task: any = {...entry.task};
      task.timeSpent = entry.timeSpent;
      task.dateStr = dayData.dateStr;
      tasks.push(task);
    });

    return dedupeByKey(tasks, 'id');
  }

  private _createTasksForMonth(data: WorklogMonth) {
    let tasks = [];
    const monthData = {...data};
    Object.keys(monthData.ent).forEach(dayDateStr => {
      const entry: WorklogDay = monthData.ent[dayDateStr];
      tasks = tasks.concat(this._createTasksForDay(entry));
    });
    return dedupeByKey(tasks, 'id');
  }
}
