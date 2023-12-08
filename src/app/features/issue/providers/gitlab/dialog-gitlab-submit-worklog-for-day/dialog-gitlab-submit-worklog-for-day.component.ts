import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { T } from 'src/app/t.const';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DateService } from '../../../../../core/date/date.service';
import { IssueTaskTimeTracked, Task, TimeSpentOnDay } from '../../../../tasks/task.model';
import { BehaviorSubject, Observable } from 'rxjs';
import { GitlabApiService } from '../gitlab-api/gitlab-api.service';
import { ProjectService } from '../../../../project/project.service';
import { first, map, tap } from 'rxjs/operators';
import { msToString } from '../../../../../ui/duration/ms-to-string.pipe';
import { throttle } from 'helpful-decorators';
import { SnackService } from '../../../../../core/snack/snack.service';
import { Store } from '@ngrx/store';
import { updateTask } from '../../../../tasks/store/task.actions';

interface TmpTask {
  id: string;
  issueId: string;
  title: string;
  timeToSubmit: number;
  timeSpentOnDay: TimeSpentOnDay;
  issueTimeTracked: IssueTaskTimeTracked | null;
  timeTrackedAlreadyRemote: number;
}

@Component({
  selector: 'dialog-gitlab-submit-worklog-for-day',
  templateUrl: './dialog-gitlab-submit-worklog-for-day.component.html',
  styleUrls: ['./dialog-gitlab-submit-worklog-for-day.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogGitlabSubmitWorklogForDayComponent {
  isLoading = false;
  day: string = this._dateService.todayStr();

  tmpTasks$: BehaviorSubject<TmpTask[]> = new BehaviorSubject<TmpTask[]>(
    this.data.tasksForProject.map((t) => ({
      id: t.id,
      issueId: t.issueId as string,
      title: t.title,
      issueTimeTracked: t.issueTimeTracked,
      timeSpentOnDay: t.timeSpentOnDay,
      timeTrackedAlreadyRemote: 0,
      timeToSubmit: Object.keys(t.timeSpentOnDay).reduce((acc, dayStr) => {
        if (t.issueTimeTracked && t.issueTimeTracked[dayStr]) {
          const diff = t.timeSpentOnDay[dayStr] - t.issueTimeTracked[dayStr];
          return diff > 0 ? diff + acc : acc;
        } else {
          return acc + t.timeSpentOnDay[dayStr];
        }
      }, 0),
    })),
  );
  tmpTasksToTrack$: Observable<TmpTask[]> = this.tmpTasks$.pipe(
    map((tasks) => tasks.filter((t) => t.timeToSubmit >= 60000)),
  );
  project$ = this._projectService.getByIdOnce$(this.data.projectId);

  totalTimeToSubmit$: Observable<number> = this.tmpTasksToTrack$.pipe(
    map((tmpTasks) =>
      tmpTasks.reduce((acc, tmpTask) => acc + (tmpTask.timeToSubmit || 0), 0),
    ),
  );
  T: typeof T = T;

  constructor(
    @Inject(MAT_DIALOG_DATA)
    public readonly data: {
      projectId: string;
      tasksForProject: Task[];
    },
    private readonly _matDialogRef: MatDialogRef<DialogGitlabSubmitWorklogForDayComponent>,
    private readonly _dateService: DateService,
    private readonly _projectService: ProjectService,
    private readonly _gitlabApiService: GitlabApiService,
    private readonly _snackService: SnackService,
    private readonly _store: Store,
  ) {
    _matDialogRef.disableClose = true;
    void this._loadAlreadyTrackedData();
  }

  updateTimeSpentTodayForTask(task: TmpTask, newVal: number | string): void {
    this.updateTmpTask(task.id, {
      timeToSubmit: +newVal,
    });
  }

  // quick way to prevent multiple submits
  @throttle(2000, { leading: true, trailing: false })
  async submit(): Promise<void> {
    this.isLoading = true;
    try {
      const tasksToTrack = await this.tmpTasksToTrack$.pipe(first()).toPromise();
      const project = await this.project$.pipe(first()).toPromise();
      if (tasksToTrack.length === 0) {
        this._snackService.open({
          type: 'SUCCESS',
          // TODO translate
          msg: 'Gitlab: No time tracking data submitted for project ' + project.title,
        });
        this.close();
        return;
      }

      const gitlabCfg = await this._projectService
        .getGitlabCfgForProject$(this.data.projectId)
        .pipe(first())
        .toPromise();
      if (!gitlabCfg) {
        throw new Error('No gitlab cfg');
      }

      await Promise.all(
        tasksToTrack.map((t) =>
          this._gitlabApiService
            .addTimeSpentToIssue$(
              t.issueId as string,
              msToString(t.timeToSubmit).replace(' ', ''),
              gitlabCfg,
            )
            .pipe(
              first(),
              tap(() =>
                this._store.dispatch(
                  updateTask({
                    task: {
                      id: t.id,
                      changes: {
                        // null all diffs as clean afterwards (regardless of amount of time submitted)
                        issueTimeTracked: { ...t.timeSpentOnDay },
                      },
                    },
                  }),
                ),
              ),
            )
            .toPromise(),
        ),
      );

      this._snackService.open({
        type: 'SUCCESS',
        ico: 'file_upload',
        // TODO translate
        msg: 'Gitlab: Successfully posted time tracking data for project' + project.title,
      });
      this.close();
    } catch (e) {
      console.error(e);
      this._snackService.open({
        type: 'ERROR',
        // TODO translate
        translateParams: {
          errorMsg: 'Error while submitting data to GitLab',
        },
        msg: T.F.GITLAB.S.ERR_UNKNOWN,
      });
    }
    this.isLoading = false;
  }

  close(): void {
    this._matDialogRef.close();
  }

  updateTmpTask(taskId: string, changes: Partial<TmpTask>): void {
    const tasks = this.tmpTasks$.getValue();
    const taskToUpdateIndex = tasks.findIndex((t) => t.id === taskId);
    tasks[taskToUpdateIndex] = {
      ...tasks[taskToUpdateIndex],
      ...changes,
    };
    this.tmpTasks$.next([...tasks]);
  }

  private async _loadAlreadyTrackedData(): Promise<void> {
    const tmpTasks = this.tmpTasks$.getValue();
    const gitlabCfg = await this._projectService
      .getGitlabCfgForProject$(this.data.projectId)
      .pipe(first())
      .toPromise();
    const dataForAll = await Promise.all(
      tmpTasks.map((t) =>
        this._gitlabApiService
          .getTimeTrackingStats$(t.issueId, gitlabCfg)
          .pipe(first())
          .toPromise(),
      ),
    );
    this.tmpTasks$.next(
      tmpTasks.map((t, i) => ({
        ...t,
        timeTrackedAlreadyRemote:
          typeof dataForAll[i].total_time_spent === 'number'
            ? (dataForAll[i].total_time_spent as number) * 1000
            : 0 || 0,
      })),
    );
  }
}
