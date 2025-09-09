// modules/extend.js
"use strict";

/**
 * Creates a sibling entity that "extends" the parent entity’s children and wiring,
 * writes a default file to S3, links both ways across siblings, and refreshes head.
 */
async function extendHandle(ctx) {
  const {
    dynamodb, uuidv4, s3, dynamodbLL,
    getSub, getEntity, incrementCounterAndGetNewValue, createWord,
    addVersion, createEntity, getUUID, createSubdomain, createFile,
    convertToJSON, updateEntity, setIsPublic,
    reqPath, reqBody, cookie
  } = ctx;

  // Path: /<anything>/extend/:fileID/:newEntityName/:headUUID
  const segs = reqPath.split("/");
  const fileID    = segs[3]; // su
  const newEntity = segs[4];
  const headUUID  = segs[5]; // su to re-emit

  const parent = await getSub(fileID, "su", dynamodb);
  setIsPublic(parent.Items[0].z);
  const eParent = await getEntity(parent.Items[0].e, dynamodb);

  const e   = await incrementCounterAndGetNewValue("eCounter", dynamodb);
  const aId = await incrementCounterAndGetNewValue("wCounter", dynamodb);
  const a   = await createWord(aId.toString(), newEntity, dynamodb);
  const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);

  await createEntity(
    e.toString(), a.toString(), details.v,
    eParent.Items[0].g, eParent.Items[0].h, eParent.Items[0].ai,
    dynamodb
  );

  const su = await getUUID(uuidv4);
  await createSubdomain(su, a.toString(), e.toString(), "0", true, dynamodb);

  // same default payload style as your route
  const fileData = {
    input: [{
      physical: [
        [{}],
        ["ROWRESULT","000","NESTED","000!!","blocks",[{ entity: su, name:"Primary"}]],
        ["ROWRESULT","000","NESTED","000!!","modules",{}],
        ["ROWRESULT","000","NESTED","000!!","actions",[
          { target:"{|res|}!", chain:[{ access:"send", params:["{|entity|}"] }], assign:"{|send|}" }
        ]],
        ["ROWRESULT","000","NESTED","000!!","menu",{}],
        ["ROWRESULT","0","NESTED","000!!","function",{}],
        ["ROWRESULT","0","NESTED","000!!","automation",[]],
        ["ROWRESULT","000","NESTED","000!!","menu",{
          ready:{ _name:"Ready", _classes:["Root"], _show:false, _selected:true,
            options:{ _name:"Options", _classes:["ready"], _show:true, _selected:false,
              back:{ _name:"Back", _classes:["options"], _show:false, _selected:false }
            },
            close:{ _name:"Close", _classes:["ready"], _show:false, _selected:false }
          }
        }],
        ["ROWRESULT","000","NESTED","000!!","commands",{
          ready:{ call:"ready", ready:false, updateSpeechAt:true, timeOut:0 },
          back:{ call:"back", ready:true, updateSpeechAt:true, timeOut:0 },
          close:{ call:"close", ready:false, updateSpeechAt:true, timeOut:0 },
          options:{ call:"options", ready:false, updateSpeechAt:true, timeOut:0 }
        }],
        ["ROWRESULT","000","NESTED","000!!","calls",{
          ready:[{ if:[{ key:["ready","_selected"], expression:"==", value:true }],
                   then:["ready"], show:["ready"],
                   run:[{ function:"show", args:["menu",0], custom:false }] }],
          back:[{ if:[{ key:["ready","_selected"], expression:"!=", value:true }],
                  then:["ready"], show:["ready"],
                  run:[{ function:"highlight", args:["ready",0], custom:false }] }],
          close:[{ if:[], then:["ready"], show:[],
                   run:[{ function:"hide", args:["menu",0] }] }],
          options:[{ if:[{ key:["ready","_selected"], expression:"==", value:true }],
                     then:["ready","options"], show:["options"], run:[] }]
        }],
        ["ROWRESULT","000","NESTED","000!!","templates",{
          init:{ "1":{ rows:{ "1":{ cols:["a","b"] } } } },
          second:{ "2":{ rows:{ "1":{ cols:["c","d"] } } } }
        }],
        ["ROWRESULT","000","NESTED","000!!","assignments",{
          a:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 1"},_mode:"_html" },
          b:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 2"},_mode:"_html" },
          c:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 3"},_mode:"_html" },
          d:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 4"},_mode:"_html" }
        }]
      ]
    }, { virtual: [] } ],
    published: {
      blocks: [{ entity: su, name:"Primary"}],
      modules: {}, function: {}, automation: [],
      actions: [{ target:"{|res|}!", chain:[{ access:"send", params:["{|entity|}"] }], assign:"{|send|}" }],
      menu: { ready:{ _name:"Ready", _classes:["Root"], _show:false, _selected:true,
        options:{ _name:"Options", _classes:["ready"], _show:true, _selected:false,
          back:{ _name:"Back", _classes:["options"], _show:false, _selected:false } },
        close:{ _name:"Close", _classes:["ready"], _show:false, _selected:false } } },
      commands: {
        ready:{ call:"ready", ready:false, updateSpeechAt:true, timeOut:0 },
        back:{ call:"back", ready:true, updateSpeechAt:true, timeOut:0 },
        close:{ call:"close", ready:false, updateSpeechAt:true, timeOut:0 },
        options:{ call:"options", ready:false, updateSpeechAt:true, timeOut:0 }
      },
      calls:{
        ready:[{ if:[{ key:["ready","_selected"], expression:"==", value:true }],
                 then:["ready"], show:["ready"], run:[{ function:"show", args:["menu",0], custom:false }] }],
        back:[{ if:[{ key:["ready","_selected"], expression:"!=", value:true }],
                then:["ready"], show:["ready"], run:[{ function:"highlight", args:["ready",0], custom:false }] }],
        close:[{ if:[], then:["ready"], show:[], run:[{ function:"hide", args:["menu",0] }] }],
        options:[{ if:[{ key:["ready","_selected"], expression:"==", value:true }],
                   then:["ready","options"], show:["options"], run:[] }]
      },
      templates:{
        init:{ "1":{ rows:{ "1":{ cols:["a","b"] } } } },
        second:{ "2":{ rows:{ "1":{ cols:["c","d"] } } } }
      },
      assignments:{
        a:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 1"},_mode:"_html" },
        b:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 2"},_mode:"_html" },
        c:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 3"},_mode:"_html" },
        d:{ _editable:false,_movement:"move",_owners:[],_modes:{ _html:"Box 4"},_mode:"_html" }
      }
    },
    skip: [], sweeps: 1, expected: []
  };

  await createFile(su, fileData, s3);

  // unlink parent’s children & relink to new e
  const updateList = eParent.Items[0].t || [];
  for (const childE of updateList) {
    const details24 = await addVersion(childE, "-f", eParent.Items[0].e, "1", dynamodb);
    await updateEntity(childE, "-f", eParent.Items[0].e, details24.v, details24.c, dynamodb);

    const details25 = await addVersion(eParent.Items[0].e, "-t", childE, "1", dynamodb);
    await updateEntity(eParent.Items[0].e, "-t", childE, details25.v, details25.c, dynamodb);

    const details26 = await addVersion(childE, "f", e.toString(), "1", dynamodb);
    await updateEntity(childE, "f", e.toString(), details26.v, details26.c, dynamodb);

    const details27 = await addVersion(e.toString(), "t", childE, "1", dynamodb);
    await updateEntity(e.toString(), "t", childE, details27.v, details27.c, dynamodb);
  }

  // link parent → new e
  const details28 = await addVersion(eParent.Items[0].e, "t", e.toString(), "1", dynamodb);
  await updateEntity(eParent.Items[0].e, "t", e.toString(), details28.v, details28.c, dynamodb);

  // set same group
  const group = eParent.Items[0].g;
  const details3 = await addVersion(e.toString(), "g", group, "1", dynamodb);
  await updateEntity(e.toString(), "g", group, details3.v, details3.c, dynamodb);

  const mainObj = await convertToJSON(
    headUUID, [], null, null, cookie,
    dynamodb, uuidv4, null, [], {}, "",
    dynamodbLL, reqBody
  );

  return { mainObj, actionFile: su };
}

// Export the handler (backward compatibility)
module.exports.handle = extendHandle;

/**
 * NEW: register hook so the loader can auto-wire this module
 * Expects your shared system to call register({ on, use })
 */
module.exports.register = function register({ on /*, use */ }) {
  on("extend", extendHandle);
};
