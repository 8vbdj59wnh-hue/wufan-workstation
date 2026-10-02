import {getDatabase} from './db.js';
import {readContribution} from './linkContributionService.js';
export function readConnectionGoalCockpitSummary(input={},context={}) {
 const database=context.database||getDatabase(),model=readContribution(database);
 const links=database.prepare("SELECT id,ownerId FROM sales_links WHERE currentState='active'").all().filter(l=>context.isAdmin||l.ownerId===context.userId);
 const ids=new Set(links.map(l=>l.id)),rows=model.results.filter(r=>ids.has(r.salesLinkId));
 const gradeSummary=Object.fromEntries(['S','A','B','C','D','N'].map(k=>[k,rows.filter(r=>r.grade===k).length]));
 const evaluatedLinks=rows.filter(r=>r.grade).length;
 return {totalLinks:links.length,evaluatedLinks,pendingEvaluationLinks:links.length-evaluatedLinks,gradeSummary,positioningSummary:[],
 evaluationPeriod:{periodStart:model.run?.periodStart||null,periodEnd:model.run?.periodEnd||null,windowDays:30},
 ratingDate:model.run?.ratingDate||null};
}
