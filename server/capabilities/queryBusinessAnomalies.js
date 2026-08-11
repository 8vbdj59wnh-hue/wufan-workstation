import { getDatabase } from "../db.js";
import { queryDailySalesSummaryComparison } from "./queryDailySales.js";
import { querySalesDailyDataQuality } from "../salesDailyDataQualityService.js";

const addDays=(date,amount)=>{const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10);};
const ratio=(current,compare)=>compare>0?(current-compare)/compare:null;
const severity=(decline)=>decline>=.5?"high":decline>=.3?"medium":"low";

export function queryBusinessAnomalies(input={},options={}){
  const database=options.database||getDatabase();const threshold=Math.min(.95,Math.max(.1,Number(input.dropThreshold??.3)));const gapDays=Math.min(30,Math.max(1,Number(input.gapDays??3)));
  const quality=querySalesDailyDataQuality({database});
  if(!quality.hasData)return{capability:"QueryBusinessAnomalies",contractVersion:"1.0",hasData:false,items:[],summary:{high:0,medium:0,low:0,total:0},quality};
  const currentEnd=quality.batch.dateEnd,currentStart=addDays(currentEnd,-6),compareEnd=addDays(currentStart,-1),compareStart=addDays(compareEnd,-6),gapStart=addDays(currentEnd,-gapDays+1);
  const objectTypes=input.objectType?[input.objectType]:["salesLink","product"];const items=[];
  for(const objectType of objectTypes){
    if(!["salesLink","product"].includes(objectType))throw new Error("经营异常对象类型无效。");
    const comparison=queryDailySalesSummaryComparison({dimension:objectType,currentStart,currentEnd,compareStart,compareEnd},{database});
    for(const row of comparison.items){
      const common={objectType,objectId:row.targetId,objectName:row.targetName,currentPeriod:comparison.currentPeriod,comparePeriod:comparison.comparePeriod,trendSummary:{currentSalesAmount:row.currentSalesAmount,compareSalesAmount:row.compareSalesAmount,currentProfitAmount:row.currentProfitAmount,compareProfitAmount:row.compareProfitAmount},baselineSnapshot:{objectType,objectId:row.targetId,period:comparison.currentPeriod,salesAmount:row.currentSalesAmount,profitAmount:row.currentProfitAmount,quantity:row.currentQuantity,dataSource:"daily_fact_v1"}};
      if(row.currentDataCount>0&&row.compareDataCount>0){
        const salesChange=ratio(row.currentSalesAmount,row.compareSalesAmount);if(salesChange!==null&&salesChange<=-threshold)items.push({...common,anomalyType:"sales_drop",severity:severity(Math.abs(salesChange)),currentValue:row.currentSalesAmount,compareValue:row.compareSalesAmount,changeRate:salesChange});
        const profitChange=ratio(row.currentProfitAmount,row.compareProfitAmount);if(profitChange!==null&&profitChange<=-threshold)items.push({...common,anomalyType:"profit_drop",severity:severity(Math.abs(profitChange)),currentValue:row.currentProfitAmount,compareValue:row.compareProfitAmount,changeRate:profitChange});
      }
      const hadHistory=row.compareDataCount>0;const gap=row.currentDataEnd===null||row.currentDataEnd<gapStart;
      if(hadHistory&&gap)items.push({...common,anomalyType:"sales_gap",severity:gapDays>=7?"high":"medium",currentValue:null,compareValue:row.compareSalesAmount,changeRate:null,gapDays,lastSalesDate:row.currentDataEnd});
    }
  }
  if(quality.health.status!=="healthy")items.push({anomalyType:"data_quality_issue",objectType:"dataQuality",objectId:quality.batch.id,objectName:"销售日报数据质量",severity:quality.health.status==="error"?"high":"medium",currentPeriod:{startDate:quality.batch.dateStart,endDate:quality.batch.dateEnd},comparePeriod:null,currentValue:quality.health.exceptionCount,compareValue:null,changeRate:null});
  const order={high:0,medium:1,low:2};items.sort((a,b)=>order[a.severity]-order[b.severity]||String(a.objectName).localeCompare(String(b.objectName),"zh-CN")||a.anomalyType.localeCompare(b.anomalyType));
  const filtered=input.anomalyType?items.filter((item)=>item.anomalyType===input.anomalyType):items;const summary={high:0,medium:0,low:0,total:filtered.length};for(const item of filtered)summary[item.severity]+=1;
  return{capability:"QueryBusinessAnomalies",contractVersion:"1.0",hasData:true,rules:{dropThreshold:threshold,gapDays},periods:{current:{startDate:currentStart,endDate:currentEnd},compare:{startDate:compareStart,endDate:compareEnd}},summary,items:filtered,sourceCapabilities:["QueryDailySalesSummary","QuerySalesDailyDataQuality"]};
}
export default queryBusinessAnomalies;
