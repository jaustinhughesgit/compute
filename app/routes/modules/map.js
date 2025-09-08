// routes/modules/map.js
/**
 * action === "map"
 * URL shape (by segments):
 *   /cookies/map/:referencedParent/:newEntityName/:mappedParent/:headEntity
 *
 * Behavior (ported from legacy conditional):
 *   - Resolve referencedParent (mrE) and mappedParent (mpE)
 *   - Create a new entity `e` with word `a` (name=newEntityName)
 *   - Inherit g/h/ai from mappedParent entity
 *   - Create a public subdomain `uniqueId` for a starter "file" payload
 *   - Persist starter file JSON to S3
 *   - Update mapping on mappedParent:
 *       mpE.m[ mrE.e ] = e
 *   - Return convertToJSON(headEntity, ...) result
 */

module.exports.register = ({ on, use }) => {
  // Shared-bus helpers
  const getSub        = use('getSub');
  const getEntity     = use('getEntity');
  const setIsPublic   = use('setIsPublic');
  const getUUID       = use('getUUID');
  const convertToJSON = use('convertToJSON');

  // Legacy helpers still exported from ../cookies
  const {
    incrementCounterAndGetNewValue,
    createWord,
    addVersion,
    createEntity,
    updateEntity,
    createSubdomain,
    createFile,
  } = require('../cookies');

  on('map', async (ctx, { cookie }) => {
    const { dynamodb, dynamodbLL, uuidv4, s3 } = ctx.deps || {};
    const parts = (ctx.path || '').split('/');

    // /cookies/map/:referencedParent/:newEntityName/:mappedParent/:headEntity
    const referencedParent = parts[3];
    const rawName          = parts[4] || '';
    const mappedParent     = parts[5];
    const headEntity       = parts[6];

    if (!referencedParent || !mappedParent || !headEntity) {
      return { ok: false, error: 'bad-request: missing path params' };
    }

    // Allow "my%20name" → "my name"
    const newEntityName = decodeURIComponent(rawName);

    try {
      // 1) Resolve parent subs + visibility (mirrors original)
      const subRefParent = await getSub(referencedParent, 'su', dynamodb);
      if (!subRefParent.Items?.length) return { ok: false, error: 'not-found: referencedParent' };
      setIsPublic(subRefParent.Items[0].z);

      const subMapParent = await getSub(mappedParent, 'su', dynamodb);
      if (!subMapParent.Items?.length) return { ok: false, error: 'not-found: mappedParent' };

      const mpE = await getEntity(subMapParent.Items[0].e, dynamodb);
      const mrE = await getEntity(subRefParent.Items[0].e, dynamodb);
      if (!mpE.Items?.length || !mrE.Items?.length) {
        return { ok: false, error: 'not-found: parent entities' };
      }

      // 2) Create new entity + word (inherit g/h/ai from mappedParent)
      const eId  = (await incrementCounterAndGetNewValue('eCounter', dynamodb)).toString();
      const wIdN = await incrementCounterAndGetNewValue('wCounter', dynamodb);
      const aId  = await createWord(wIdN.toString(), newEntityName, dynamodb);
      const v1   = await addVersion(eId, 'a', aId.toString(), null, dynamodb);

      const g   = mpE.Items[0].g;
      const h   = mpE.Items[0].h;
      const ai  = mpE.Items[0].ai;

      await createEntity(eId, aId.toString(), v1.v, g, h, ai, dynamodb);

      // 3) Create a public subdomain + starter file
      const uniqueId = await getUUID(uuidv4);
      await createSubdomain(uniqueId, aId.toString(), eId, '0', true, dynamodb);

      const starter = {
        input: [
          {
            physical: [
              [{}],
              ['ROWRESULT','000','NESTED','000!!','blocks',[{ entity: uniqueId, name: 'Primary' }]],
              ['ROWRESULT','000','NESTED','000!!','modules',{}],
              ['ROWRESULT','000','NESTED','000!!','actions',[{ target: '{|res|}!', chain: [{ access: 'send', params: ['{|entity|}']}], assign: '{|send|}' }]],
              ['ROWRESULT','000','NESTED','000!!','menu',{}],
              ['ROWRESULT','0','NESTED','000!!','function',{}],
              ['ROWRESULT','0','NESTED','000!!','automation',[]],
              ['ROWRESULT','000','NESTED','000!!','menu',{
                ready: {
                  _name: 'Ready', _classes: ['Root'], _show: false, _selected: true,
                  options: { _name: 'Options', _classes: ['ready'], _show: true, _selected: false,
                    back: { _name: 'Back', _classes: ['options'], _show: false, _selected: false } },
                  close: { _name: 'Close', _classes: ['ready'], _show: false, _selected: false }
                }
              }],
              ['ROWRESULT','000','NESTED','000!!','commands',{
                ready:  { call: 'ready',  ready: false, updateSpeechAt: true, timeOut: 0 },
                back:   { call: 'back',   ready: true,  updateSpeechAt: true, timeOut: 0 },
                close:  { call: 'close',  ready: false, updateSpeechAt: true, timeOut: 0 },
                options:{ call: 'options',ready: false, updateSpeechAt: true, timeOut: 0 },
              }],
              ['ROWRESULT','000','NESTED','000!!','calls',{
                ready:  [{ if:[{ key:['ready','_selected'], expression:'==', value:true }], then:['ready'], show:['ready'], run:[{ function:'show', args:['menu',0], custom:false }]}],
                back:   [{ if:[{ key:['ready','_selected'], expression:'!=', value:true }], then:['ready'], show:['ready'], run:[{ function:'highlight', args:['ready',0], custom:false }]}],
                close:  [{ if:[], then:['ready'], show:[], run:[{ function:'hide', args:['menu',0] }]}],
                options:[{ if:[{ key:['ready','_selected'], expression:'==', value:true }], then:['ready','options'], show:['options'], run:[] }],
              }],
              ['ROWRESULT','000','NESTED','000!!','templates',{
                init:   { '1': { rows: { '1': { cols: ['a','b'] } } } },
                second: { '2': { rows: { '1': { cols: ['c','d'] } } } }
              }],
              ['ROWRESULT','000','NESTED','000!!','assignments',{
                a:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Hello5' },_mode:'_html' },
                b:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Hello6' },_mode:'_html' },
                c:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Hello7' },_mode:'_html' },
                d:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Hello8' },_mode:'_html' },
              }],
            ]
          },
          { virtual: [] }
        ],
        published: {
          blocks: [{ entity: uniqueId, name: 'Primary' }],
          modules: {},
          actions: [{ target: '{|res|}!', chain: [{ access: 'send', params: ['{|entity|}']}], assign: '{|send|}' }],
          function: {},
          automation: [],
          menu: {
            ready: {
              _name:'Ready', _classes:['Root'], _show:false, _selected:true,
              options:{ _name:'Options', _classes:['ready'], _show:true, _selected:false,
                back:{ _name:'Back', _classes:['options'], _show:false, _selected:false } },
              close:{ _name:'Close', _classes:['ready'], _show:false, _selected:false },
            }
          },
          commands: {
            ready:  { call:'ready',  ready:false, updateSpeechAt:true, timeOut:0 },
            back:   { call:'back',   ready:true,  updateSpeechAt:true, timeOut:0 },
            close:  { call:'close',  ready:false, updateSpeechAt:true, timeOut:0 },
            options:{ call:'options',ready:false, updateSpeechAt:true, timeOut:0 },
          },
          calls: {
            ready:  [{ if:[{ key:['ready','_selected'], expression:'==', value:true }], then:['ready'], show:['ready'], run:[{ function:'show', args:['menu',0], custom:false }]}],
            back:   [{ if:[{ key:['ready','_selected'], expression:'!=', value:true }], then:['ready'], show:['ready'], run:[{ function:'highlight', args:['ready',0], custom:false }]}],
            close:  [{ if:[], then:['ready'], show:[], run:[{ function:'hide', args:['menu',0] }]}],
            options:[{ if:[{ key:['ready','_selected'], expression:'==', value:true }], then:['ready','options'], show:['options'], run:[] }],
          },
          templates: {
            init:   { '1': { rows: { '1': { cols: ['a','b'] } } } },
            second: { '2': { rows: { '1': { cols: ['c','d'] } } } }
          },
          assignments: {
            a:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Box 1' },_mode:'_html' },
            b:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Box 2' },_mode:'_html' },
            c:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Box 3' },_mode:'_html' },
            d:{ _editable:false,_movement:'move',_owners:[],_modes:{ _html:'Box 4' },_mode:'_html' },
          },
        },
        skip: [],
        sweeps: 1,
        expected: []
      };

      await createFile(uniqueId, starter, s3);

      // 4) Update mapping on mappedParent to point mrE.e → new eId
      const newM = {};
      newM[mrE.Items[0].e] = eId;

      const v2 = await addVersion(
        mpE.Items[0].e.toString(),
        'm',
        newM,
        mpE.Items[0].c,
        dynamodb
      );

      const addM = {};
      addM[mrE.Items[0].e] = [eId];

      await updateEntity(
        mpE.Items[0].e.toString(),
        'm',
        addM,
        v2.v,
        v2.c,
        dynamodb
      );

      // 5) Return updated view for headEntity
      const mainObj = await convertToJSON(
        headEntity,
        [],
        null,
        null,
        cookie,
        dynamodb,
        uuidv4,
        null,
        [],
        {},
        '',
        dynamodbLL,
        ctx.req?.body
      );

      return { ok: true, response: mainObj };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
};
