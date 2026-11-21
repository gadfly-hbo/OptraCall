import { Type } from 'typebox';

const title=Type.String({minLength:1,maxLength:300});
const field=Type.String({maxLength:6000});
const optionalField=Type.Optional(field);
const metricFields={baseline:optionalField,baselineKind:optionalField,target:optionalField,unit:optionalField,period:optionalField};
const exact={additionalProperties:false};
const bbox=Type.Array(Type.Number(),{minItems:4,maxItems:4});
const sourceLocation=Type.Object({sourceId:title,fileName:Type.Optional(title),page:Type.Optional(Type.Integer({minimum:1})),sheet:Type.Optional(title),row:Type.Optional(Type.Integer({minimum:1})),cell:Type.Optional(title),objectId:Type.Optional(title),label:title,bbox:Type.Optional(bbox),fromBbox:Type.Optional(bbox),toBbox:Type.Optional(bbox),arrowBbox:Type.Optional(bbox)},exact);
const reviewState=Type.Union(['clear','needs-review','confirmed'].map(x=>Type.Literal(x)));
const sourceConflict=Type.Object({field:title,values:Type.Array(Type.Object({value:field,label:title,locationLabel:title},exact),{minItems:1,maxItems:10})},exact);
const multiImportSource=Type.Object({sourceId:title,format:Type.Union(['xlsx','pptx','pdf','image'].map(x=>Type.Literal(x))),fileName:title,sha256:Type.String({pattern:'^[0-9a-f]{64}$'}),origin:Type.Union(['upload','discussion-attachment','project-file'].map(x=>Type.Literal(x))),selectedPages:Type.Optional(Type.Array(Type.Integer({minimum:1}),{maxItems:200})),imageMeta:Type.Optional(Type.Object({width:Type.Integer({minimum:1}),height:Type.Integer({minimum:1}),orientation:Type.Optional(Type.Integer({minimum:1,maximum:8}))},exact))},exact);
const review=Type.Object({summary:field,mechanism:field,condition:field,alternative:field,risk:field,scope:field,test:field},exact);
const node=Type.Object({id:title,kind:Type.Union(['goal','strategy','other'].map(x=>Type.Literal(x))),title,owner:optionalField,detail:optionalField,perspective:optionalField,
  metric:optionalField,...metricFields,metrics:Type.Optional(Type.Array(Type.Object({metric:title,...metricFields},exact))),
  sourceLocation:Type.Optional(sourceLocation),reviewState:Type.Optional(reviewState),ambiguityReason:optionalField,sourceConflicts:Type.Optional(Type.Array(sourceConflict,{maxItems:20}))},exact);
const edge=Type.Object({id:title,from:title,to:title,kind:Type.Union(['supports','upstream','decomposition','hypothesis','unknown'].map(x=>Type.Literal(x))),
  review:Type.Optional(review),citationTokens:Type.Optional(Type.Array(title)),sourceLocation:Type.Optional(sourceLocation),reviewState:Type.Optional(reviewState),ambiguityReason:optionalField},exact);
const coverageModel=Type.Object({population:title,metric:title,unit:title,period:title,baselineRate:Type.Number(),liftPoints:Type.Number(),coverage:Type.Number(),coverageAdjustable:Type.Boolean(),basis:field},exact);
const repeatVisitsModel=Type.Object({model:Type.Literal('repeat-visits-v1'),population:title,metric:title,unit:title,period:title,baselineRate:Type.Number(),remote:Type.Number(),parts:Type.Number(),fixed:Type.Number(),basis:field},exact);
const model=Type.Union([coverageModel,repeatVisitsModel]);
export const strategyMapDraftSchema=Type.Object({title,template:Type.Union(['table','tree','bsc'].map(x=>Type.Literal(x))),choice:optionalField,
  excluded:optionalField,assumptions:optionalField,unknowns:optionalField,nodes:Type.Array(node,{minItems:1}),edges:Type.Array(edge),importSources:Type.Optional(Type.Array(multiImportSource,{maxItems:20})),scenarioModel:Type.Optional(model)},exact);
