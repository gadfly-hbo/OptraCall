import { Type } from 'typebox';

const title=Type.String({minLength:1,maxLength:300});
const field=Type.String({maxLength:6000});
const optionalField=Type.Optional(field);
const metricFields={baseline:optionalField,baselineKind:optionalField,target:optionalField,unit:optionalField,period:optionalField};
const exact={additionalProperties:false};
const review=Type.Object({summary:field,mechanism:field,condition:field,alternative:field,risk:field,scope:field,test:field},exact);
const node=Type.Object({id:title,kind:Type.Union(['goal','strategy','other'].map(x=>Type.Literal(x))),title,owner:optionalField,detail:optionalField,perspective:optionalField,
  metric:optionalField,...metricFields,metrics:Type.Optional(Type.Array(Type.Object({metric:title,...metricFields},exact)))},exact);
const edge=Type.Object({id:title,from:title,to:title,kind:Type.Union(['supports','upstream','decomposition','hypothesis'].map(x=>Type.Literal(x))),
  review:Type.Optional(review),citationTokens:Type.Optional(Type.Array(title))},exact);
const coverageModel=Type.Object({population:title,metric:title,unit:title,period:title,baselineRate:Type.Number(),liftPoints:Type.Number(),coverage:Type.Number(),coverageAdjustable:Type.Boolean(),basis:field},exact);
const repeatVisitsModel=Type.Object({model:Type.Literal('repeat-visits-v1'),population:title,metric:title,unit:title,period:title,baselineRate:Type.Number(),remote:Type.Number(),parts:Type.Number(),fixed:Type.Number(),basis:field},exact);
const model=Type.Union([coverageModel,repeatVisitsModel]);
export const strategyMapDraftSchema=Type.Object({title,template:Type.Union(['table','tree','bsc'].map(x=>Type.Literal(x))),choice:optionalField,
  excluded:optionalField,assumptions:optionalField,unknowns:optionalField,nodes:Type.Array(node,{minItems:1}),edges:Type.Array(edge),scenarioModel:Type.Optional(model)},exact);
