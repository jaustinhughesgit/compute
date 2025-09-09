// modules/tasks.js
"use strict";

// Preserve legacy AWS EventBridge Scheduler behavior (v3 SDK)
// This mirrors the old monolith's usage of UpdateScheduleCommand.
let SchedulerClient, UpdateScheduleCommand; // lazy-require to avoid bundling unless used

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient,
    moment,
    // domain helpers
    getTasks,
    getTasksIOS,
    incrementCounterAndGetNewValue,
    // raw deps if ever needed
    deps,
  } = use();

  // ────────────────────────────────────────────────────────────────────────────
  // Internal helpers (ported verbatim from old cookies.js with minimal wiring)
  // ────────────────────────────────────────────────────────────────────────────

  async function shiftDaysOfWeekForward(daysOfWeek) {
    return {
      sunday: daysOfWeek.saturday,
      monday: daysOfWeek.sunday,
      tuesday: daysOfWeek.monday,
      wednesday: daysOfWeek.tuesday,
      thursday: daysOfWeek.wednesday,
      friday: daysOfWeek.thursday,
      saturday: daysOfWeek.friday,
    };
  }

  async function convertTimespanToUTC(options) {
    const { startDate, endDate, startTime, endTime, timeZone, ...daysOfWeek } = options;
    const m = moment; // use shared moment (tz-capable in shared)

    let sOrigUTC = await m.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let startUTC = await m.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();
    let eOrigUTC = await m.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let endUTC = await m.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();

    let firstTimespan;
    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
      if (sOrigUTC.format("YYYY-MM-DD") != startUTC.format("YYYY-MM-DD")) {
        let nextDayShiftedDaysOfWeek = await shiftDaysOfWeekForward(daysOfWeek);
        firstTimespan = await {
          startDate: startUTC.format("YYYY-MM-DD"),
          endDate: endUTC.format("YYYY-MM-DD"),
          startTime: await startUTC.format("HH:mm"),
          endTime: await endUTC.format("HH:mm"),
          timeZone: "UTC",
          ...nextDayShiftedDaysOfWeek,
        };
      } else {
        firstTimespan = await {
          startDate: startUTC.format("YYYY-MM-DD"),
          endDate: eOrigUTC.format("YYYY-MM-DD"),
          startTime: await startUTC.format("HH:mm"),
          endTime: await endUTC.clone().endOf("day").format("HH:mm"),
          timeZone: "UTC",
          ...daysOfWeek,
        };
      }
    } else {
      firstTimespan = await {
        startDate: startUTC.format("YYYY-MM-DD"),
        endDate: endUTC.format("YYYY-MM-DD"),
        startTime: await startUTC.format("HH:mm"),
        endTime: await endUTC.format("HH:mm"),
        timeZone: "UTC",
        ...daysOfWeek,
      };
    }

    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
      endUTC.clone().add(1, "day");
    }

    let timespans = [firstTimespan];
    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
      if (sOrigUTC.format("YYYY-MM-DD") == startUTC.format("YYYY-MM-DD")) {
        let nextDayShiftedDaysOfWeek = await shiftDaysOfWeekForward(daysOfWeek);
        let secondTimespan = await {
          startDate: await startUTC.format("YYYY-MM-DD"),
          endDate: await endUTC.format("YYYY-MM-DD"),
          startTime: "00:00",
          endTime: await endUTC.format("HH:mm"),
          timeZone: "UTC",
          ...nextDayShiftedDaysOfWeek,
        };
        timespans.push(secondTimespan);
      }
    }
    return timespans;
  }

  async function createTaskRow({ ti, en, sd, ed, st, et, zo, it, mo, tu, we, th, fr, sa, su, ex }) {
    const ddb = getDocClient();
    await ddb
      .put({
        TableName: "tasks",
        Item: {
          ti: ti.toString(),
          url: en,
          sd,
          ed,
          st,
          et,
          zo,
          it,
          mo,
          tu,
          we,
          th,
          fr,
          sa,
          su,
          ex,
        },
      })
      .promise();
    return ti;
  }

  async function createScheduleRowsAndEB({ ti, en, sdS, edS, stS, etS, itS, moS, tuS, weS, thS, frS, saS, suS, ex }) {
    const ddb = getDocClient();

    const si = await incrementCounterAndGetNewValue("siCounter");
    await ddb
      .put({
        TableName: "schedules",
        Item: {
          si: si.toString(),
          ti: ti.toString(),
          url: en,
          sd: sdS,
          ed: edS,
          st: stS,
          et: etS,
          it: itS,
          mo: moS,
          tu: tuS,
          we: weS,
          th: thS,
          fr: frS,
          sa: saS,
          su: suS,
          ex,
        },
      })
      .promise();

    // Legacy behavior: if first timespan covers "today" and its DOW is enabled, push EB Scheduler updates
    const stUnix = sdS + stS;
    const etUnix = sdS + etS;

    const objDate = moment.utc(stUnix * 1000);
    const today = moment.utc();
    const isToday = objDate.isSame(today, "day");

    const dow = { mo: moS, tu: tuS, we: weS, th: thS, fr: frS, sa: saS, su: suS };
    const todayIndex = moment().utc().day();
    const dayCodes = ["su", "mo", "tu", "we", "th", "fr", "sa"];
    const todayCode = dayCodes[todayIndex];
    const isTodayOn = dow[todayCode] === 1;

    if (isToday && isTodayOn) {
      // Lazy-load v3 client (keeps module light when not needed)
      if (!SchedulerClient || !UpdateScheduleCommand) {
        ({ SchedulerClient, UpdateScheduleCommand } = require("@aws-sdk/client-scheduler"));
      }

      const client = new SchedulerClient({ region: "us-east-1" });

      // fetch current EN value (legacy parity)
      const enData = await ddb
        .query({
          TableName: "enCounter",
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": "enCounter" },
        })
        .promise();

      let startTime = moment(stUnix * 1000);
      let endTime = moment(etUnix * 1000);

      while (startTime <= endTime) {
        const hour = startTime.format("HH");
        const minute = startTime.format("mm");
        const hourFormatted = hour.toString().padStart(2, "0");
        const minuteFormatted = minute.toString().padStart(2, "0");

        const scheduleName = `${hourFormatted}${minuteFormatted}`;
        const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

        const input = {
          Name: scheduleName,
          GroupName: "runLambda",
          ScheduleExpression: scheduleExpression,
          ScheduleExpressionTimezone: "UTC",
          StartDate: new Date(moment.utc().format()),
          EndDate: new Date("2030-01-01T00:00:00Z"),
          State: "ENABLED",
          Target: {
            Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp",
            RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
            Input: JSON.stringify({ disable: true, automate: true }),
          },
          FlexibleTimeWindow: { Mode: "OFF" },
        };

        try {
          const command = new UpdateScheduleCommand(input);
          await client.send(command);

          // mark as enabled in legacy table
          await ddb
            .update({
              TableName: "enabled",
              Key: { time: scheduleName },
              UpdateExpression: "set #enabled = :enabled, #en = :en",
              ExpressionAttributeNames: { "#enabled": "enabled", "#en": "en" },
              ExpressionAttributeValues: {
                ":enabled": 1,
                ":en": enData.Items?.[0]?.x,
              },
              ReturnValues: "UPDATED_NEW",
            })
            .promise();
        } catch (err) {
          // swallow to preserve original silent-failure behavior
        }

        startTime.add(itS, "minutes");
      }
    }

    return "done";
  }

  async function removeSchedule(ti) {
    const ddb = getDocClient();
    const tiVal = typeof ti === "string" ? ti : String(ti);

    // delete schedules for this task
    const query = await ddb
      .query({
        TableName: "schedules",
        IndexName: "tiIndex",
        KeyConditionExpression: "ti = :tiVal",
        ExpressionAttributeValues: { ":tiVal": tiVal },
      })
      .promise();

    for (const item of query.Items || []) {
      await ddb
        .delete({ TableName: "schedules", Key: { si: item.si } })
        .promise();
    }

    // delete the task row too (legacy behavior)
    await ddb.delete({ TableName: "tasks", Key: { ti: tiVal } }).promise();

    return "success";
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────────────────────────────────

  function firstPathSeg(p) {
    return String(p || "/")
      .split("?")[0]
      .split("/")
      .filter(Boolean)[0] || "";
  }

  function getPayload(req) {
    // strict-parity: support both flattened req.body and legacy body.body
    const b = req?.body;
    return (b && typeof b === "object" && b.body && typeof b.body === "object") ? b.body : b;
  }

  on("tasks", async (ctx, meta) => {
    const { req, path } = ctx;
    const sub = firstPathSeg(path);

    const tasksUnix = await getTasks(sub, "su");
    const tasksISO = await getTasksIOS(tasksUnix);

    return {
      ok: true,
      response: {
        tasks: tasksISO,
        existing: meta?.cookie?.existing,
        file: sub + "",
      },
    };
  });

  on("createTask", async (ctx, meta) => {
    const { req, path } = ctx;
    const sub = firstPathSeg(path); // fileID (su)
    const task = getPayload(req) || {};

    // parse inputs (legacy identical logic)
    let sDate = new Date((task.startDate || "") + "T00:00:00Z");
    let sDateSeconds = Math.floor(sDate.getTime() / 1000);

    let eDate = new Date((task.endDate || "") + "T00:00:00Z");
    let eDateSeconds = Math.floor(eDate.getTime() / 1000);

    const [sHours = 0, sMinutes = 0] = String(task.startTime || "0:0").split(":").map(Number);
    const sSeconds = sHours * 3600 + sMinutes * 60;

    const [eHours = 0, eMinutes = 0] = String(task.endTime || "0:0").split(":").map(Number);
    const eSeconds = eHours * 3600 + eMinutes * 60;

    const en = sub;
    const sd = sDateSeconds;
    const ed = eDateSeconds;
    const st = sSeconds;
    const et = eSeconds;
    const zo = task.zone;
    const it = task.interval;

    const mo = task.monday;
    const tu = task.tuesday;
    const we = task.wednesday;
    const th = task.thursday;
    const fr = task.friday;
    const sa = task.saturday;
    const su = task.sunday;

    const taskJSON = {
      startDate: task.startDate,
      endDate: task.endDate,
      startTime: task.startTime,
      endTime: task.endTime,
      timeZone: zo,
      monday: mo,
      tuesday: tu,
      wednesday: we,
      thursday: th,
      friday: fr,
      saturday: sa,
      sunday: su,
    };

    const schedules = await convertTimespanToUTC(taskJSON);

    let ti;
    if (!task.taskID) {
      ti = await incrementCounterAndGetNewValue("tiCounter");
    } else {
      ti = task.taskID;
      await removeSchedule(ti);
    }

    let ex = 0;
    for (const schedule of schedules) {
      let sDateS = new Date(schedule.startDate + "T00:00:00Z");
      let sDateSecondsS = Math.floor(sDateS.getTime() / 1000);

      let eDateS = new Date(schedule.endDate + "T00:00:00Z");
      let eDateSecondsS = Math.floor(eDateS.getTime() / 1000);

      const [sHoursS = 0, sMinutesS = 0] = String(schedule.startTime || "0:0").split(":").map(Number);
      const sSecondsS = sHoursS * 3600 + sMinutesS * 60;

      const [eHoursS = 0, eMinutesS = 0] = String(schedule.endTime || "0:0").split(":").map(Number);
      const eSecondsS = eHoursS * 3600 + eMinutesS * 60;

      const sdS = sDateSecondsS;
      const edS = eDateSecondsS;
      const stS = sSecondsS;
      const etS = eSecondsS;
      const itS = it;

      const moS = schedule.monday;
      const tuS = schedule.tuesday;
      const weS = schedule.wednesday;
      const thS = schedule.thursday;
      const frS = schedule.friday;
      const saS = schedule.saturday;
      const suS = schedule.sunday;

      ex = eDateSecondsS + eSecondsS;

      await createScheduleRowsAndEB({
        ti,
        en,
        sdS,
        edS,
        stS,
        etS,
        itS,
        moS: +moS,
        tuS: +tuS,
        weS: +weS,
        thS: +thS,
        frS: +frS,
        saS: +saS,
        suS: +suS,
        ex,
      });
    }

    if (ex > 0) {
      await createTaskRow({
        ti,
        en,
        sd,
        ed,
        st,
        et,
        zo,
        it,
        mo: +mo,
        tu: +tu,
        we: +we,
        th: +th,
        fr: +fr,
        sa: +sa,
        su: +su,
        ex,
      });
    }

    const tasksUnix = await getTasks(sub, "su");
    const tasksISO = await getTasksIOS(tasksUnix);

    return {
      ok: true,
      response: {
        tasks: tasksISO,
        existing: meta?.cookie?.existing,
        file: sub + "",
      },
    };
  });

  on("deleteTask", async (ctx, meta) => {
    const { req, path } = ctx;
    const sub = firstPathSeg(path);
    const payload = getPayload(req) || {};

    if (payload && payload.taskID) {
      await removeSchedule(payload.taskID);
    }

    const tasksUnix = await getTasks(sub, "su");
    const tasksISO = await getTasksIOS(tasksUnix);

    return {
      ok: true,
      response: {
        tasks: tasksISO,
        existing: meta?.cookie?.existing,
        file: sub + "",
      },
    };
  });

  return { name: "tasks" };
}

module.exports = { register };
