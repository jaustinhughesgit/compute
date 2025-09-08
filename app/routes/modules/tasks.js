//routes/modules/tasks.js
/** Capabilities:
 *  - action === "tasks"       → list tasks for a file (by su)
 *  - action === "createTask"  → create/update task & schedules
 *  - action === "deleteTask"  → delete task & schedules
 */
module.exports.register = ({ on, use }) => {
  on('tasks', async (ctx) => {
    const { dynamodb } = ctx.deps;
    const getTasks    = use('getTasks');
    const getTasksIOS = use('getTasksIOS');

    const fileID = ctx.path.split('/')[3];
    const tasksUnix = await getTasks(fileID, 'su', dynamodb);
    const tasksISO  = await getTasksIOS(tasksUnix);

    return { ok: true, response: { file: fileID, tasks: tasksISO } };
  });

  on('createTask', async (ctx) => {
    const { dynamodb } = ctx.deps;

    const getTasks                  = use('getTasks');
    const getTasksIOS               = use('getTasksIOS');
    const convertTimespanToUTC      = use('convertTimespanToUTC');
    const createSchedule            = use('createSchedule');
    const createTask                = use('createTask');
    const removeSchedule            = use('removeSchedule');
    const incrementCounterAndGetNewValue = use('incrementCounterAndGetNewValue');

    const fileID = ctx.path.split('/')[3];
    const task   = ctx.req.body.body;   // matches original payload shape

    // Convert dates/times
    const sDateSec = Math.floor(new Date(task.startDate + 'T00:00:00Z').getTime() / 1000);
    const eDateSec = Math.floor(new Date(task.endDate + 'T00:00:00Z').getTime() / 1000);
    const [sH, sM] = task.startTime.split(':').map(Number);
    const [eH, eM] = task.endTime.split(':').map(Number);
    const st = (sH * 3600) + (sM * 60);
    const et = (eH * 3600) + (eM * 60);

    const baseTimespan = {
      startDate: task.startDate,
      endDate:   task.endDate,
      startTime: task.startTime,
      endTime:   task.endTime,
      timeZone:  task.zone,
      monday:    task.monday,
      tuesday:   task.tuesday,
      wednesday: task.wednesday,
      thursday:  task.thursday,
      friday:    task.friday,
      saturday:  task.saturday,
      sunday:    task.sunday
    };

    const spans = await convertTimespanToUTC(baseTimespan);

    // New or update?
    let ti;
    if (!task.taskID) {
      ti = await incrementCounterAndGetNewValue('tiCounter', dynamodb);
    } else {
      ti = task.taskID;
      await removeSchedule(ti);
    }

    let ex = 0;
    for (const s of spans) {
      const sdS = Math.floor(new Date(s.startDate + 'T00:00:00Z').getTime() / 1000);
      const edS = Math.floor(new Date(s.endDate   + 'T00:00:00Z').getTime() / 1000);
      const [sHs, sMs] = s.startTime.split(':').map(Number);
      const [eHs, eMs] = s.endTime.split(':').map(Number);
      const stS = (sHs * 3600) + (sMs * 60);
      const etS = (eHs * 3600) + (eMs * 60);

      ex = edS + etS; // last span end

      await createSchedule(
        ti, fileID,
        sdS, edS, stS, etS,
        task.interval,
        +s.monday, +s.tuesday, +s.wednesday, +s.thursday, +s.friday, +s.saturday, +s.sunday,
        ex, dynamodb
      );
    }

    if (ex > 0) {
      await createTask(
        ti, fileID, sDateSec, eDateSec, st, et, task.zone, task.interval,
        +task.monday, +task.tuesday, +task.wednesday, +task.thursday, +task.friday, +task.saturday, +task.sunday,
        ex, dynamodb
      );
    }

    const tasksUnix = await getTasks(fileID, 'su', dynamodb);
    const tasksISO  = await getTasksIOS(tasksUnix);
    return { ok: true, response: { file: fileID, tasks: tasksISO } };
  });

  on('deleteTask', async (ctx) => {
    const { dynamodb } = ctx.deps;
    const getTasks    = use('getTasks');
    const getTasksIOS = use('getTasksIOS');
    const removeSchedule = use('removeSchedule');

    const fileID = ctx.path.split('/')[3];
    const task   = ctx.req.body.body;

    await removeSchedule(task.taskID);

    const tasksUnix = await getTasks(fileID, 'su', dynamodb);
    const tasksISO  = await getTasksIOS(tasksUnix);
    return { ok: true, response: { file: fileID, tasks: tasksISO } };
  });
};
