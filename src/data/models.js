/**
 * @typedef {typeof import("./modelOptions.js").Status[keyof typeof import("./modelOptions.js").Status]} StatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").PersonRole[keyof typeof import("./modelOptions.js").PersonRole]} PersonRoleValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").CategoryType[keyof typeof import("./modelOptions.js").CategoryType]} CategoryTypeValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").GoalLevel[keyof typeof import("./modelOptions.js").GoalLevel]} GoalLevelValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").GoalType[keyof typeof import("./modelOptions.js").GoalType]} GoalTypeValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").GoalPeriodType[keyof typeof import("./modelOptions.js").GoalPeriodType]} GoalPeriodTypeValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").MetricDirection[keyof typeof import("./modelOptions.js").MetricDirection]} MetricDirectionValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").GoalStatus[keyof typeof import("./modelOptions.js").GoalStatus]} GoalStatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").TaskSource[keyof typeof import("./modelOptions.js").TaskSource]} TaskSourceValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").TaskImportance[keyof typeof import("./modelOptions.js").TaskImportance]} TaskImportanceValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").TaskUrgency[keyof typeof import("./modelOptions.js").TaskUrgency]} TaskUrgencyValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").TaskStatus[keyof typeof import("./modelOptions.js").TaskStatus]} TaskStatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").TaskTemplateStatus[keyof typeof import("./modelOptions.js").TaskTemplateStatus]} TaskTemplateStatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ProcessTemplateStatus[keyof typeof import("./modelOptions.js").ProcessTemplateStatus]} ProcessTemplateStatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ProcessTemplateNodeStatus[keyof typeof import("./modelOptions.js").ProcessTemplateNodeStatus]} ProcessTemplateNodeStatusValue
 * @typedef {typeof import("./modelOptions.js").SubmitType[keyof typeof import("./modelOptions.js").SubmitType]} SubmitTypeValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ProcessOwnerRule[keyof typeof import("./modelOptions.js").ProcessOwnerRule]} ProcessOwnerRuleValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ProcessAccepterRule[keyof typeof import("./modelOptions.js").ProcessAccepterRule]} ProcessAccepterRuleValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ProcessInstanceStatus[keyof typeof import("./modelOptions.js").ProcessInstanceStatus]} ProcessInstanceStatusValue
 */

/**
 * @typedef {typeof import("./modelOptions.js").ContentScheduleStatus[keyof typeof import("./modelOptions.js").ContentScheduleStatus]} ContentScheduleStatusValue
 *
 * @typedef {typeof import("./modelOptions.js").WorkPlanStatus[keyof typeof import("./modelOptions.js").WorkPlanStatus]} WorkPlanStatusValue
 */

/**
 * @typedef {object} Company
 * @property {string} id
 * @property {string} name
 * @property {StatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Department
 * @property {string} id
 * @property {string} companyId
 * @property {string} name
 * @property {string | null} leaderId
 * @property {string | null} parentDepartmentId
 * @property {number} sortOrder
 * @property {StatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Position
 * @property {string} id
 * @property {string} departmentId
 * @property {string} name
 * @property {number} sortOrder
 * @property {StatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Person
 * @property {string} id
 * @property {string} name
 * @property {string} account
 * @property {string} departmentId
 * @property {string} positionId
 * @property {string | null} directManagerId
 * @property {PersonRoleValue} role
 * @property {StatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Category
 * @property {string} id
 * @property {CategoryTypeValue} type
 * @property {string} name
 * @property {number} sortOrder
 * @property {StatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Goal alignment rules:
 * 1. A company ultimate goal has no parentGoalId.
 * 2. A department ultimate goal must align to a company ultimate goal.
 * 3. A period goal must set periodType and periodValue.
 * 4. An ultimate goal does not need periodType or periodValue.
 * 5. A period goal must set metricName, metricUnit, metricDirection, targetValue, and currentValue.
 * 6. A company goal has an empty departmentId.
 * 7. A department goal must set departmentId.
 * 8. Every goal should trace back to a company ultimate goal.
 * 9. A goal cannot set parentGoalId to itself.
 * 10. Goal alignment cannot form a cycle.
 *
 * @typedef {object} Goal
 * @property {string} id
 * @property {string} name
 * @property {GoalLevelValue} level
 * @property {GoalTypeValue} type
 * @property {GoalPeriodTypeValue | null} periodType
 * @property {string | null} periodValue
 * @property {string | null} departmentId
 * @property {string} ownerId
 * @property {string | null} parentGoalId
 * @property {string | null} metricName
 * @property {string | null} metricUnit
 * @property {MetricDirectionValue | null} metricDirection
 * @property {number | null} targetValue
 * @property {number | null} currentValue
 * @property {string} description
 * @property {GoalStatusValue} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} name
 * @property {string} goalId
 * @property {string | null} taskTemplateId
 * @property {TaskSourceValue} source
 * @property {string | null} processInstanceId
 * @property {string | null} processNodeId
 * @property {string | null} categoryId
 * @property {string} departmentId
 * @property {string} ownerId
 * @property {string} initiatorId
 * @property {string} description
 * @property {string} completionStandard
 * @property {string | null} reviewStandard
 * @property {string | null} outputRequirement
 * @property {TaskImportanceValue} importance
 * @property {TaskUrgencyValue} urgency
 * @property {string | null} startDate
 * @property {string | null} dueDate
 * @property {string | null} plannedWeek
 * @property {boolean} needAcceptance
 * @property {string | null} accepterId
 * @property {TaskStatusValue} status
 * @property {string | null} resultText
 * @property {string[]} resultAttachments
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} completedAt
 * @property {Record<string, string | string[]>} customFields
 * @property {string | null} displayTitle
 * @property {string | null} coverImageUrl
 * @property {SubmitTypeValue} submitType
 * @property {string | null} submitDescription
 * @property {SubmitField[]} submitFields
 * @property {Record<string, string | string[]>} submitFormData
 * @property {SubmittedFile[]} submitFiles
 * @property {string[]} submitLinks
 * @property {string | null} submittedAt
 * @property {string | null} submittedBy
 */

/**
 * @typedef {object} SubmitField
 * @property {string} id
 * @property {string} label
 * @property {string} key
 * @property {"text" | "textarea" | "number" | "date" | "select" | "multi_select" | "url"} type
 * @property {boolean} required
 * @property {string | null} placeholder
 * @property {string[] | null} options
 * @property {number} sortOrder
 */

/**
 * @typedef {object} SubmittedFile
 * @property {string} url
 * @property {string} filename
 * @property {string} originalName
 * @property {number} size
 * @property {string} mimeType
 */

/**
 * @typedef {object} TaskTemplateFormField
 * @property {string} id
 * @property {string} label
 * @property {string} key
 * @property {"text" | "textarea" | "date" | "number" | "select" | "multi_select" | "url" | "image"} type
 * @property {boolean} required
 * @property {string | null} placeholder
 * @property {string[] | null} options
 * @property {boolean} showInList
 * @property {number} sortOrder
 */

/**
 * @typedef {object} TaskTemplate
 * @property {string} id
 * @property {string} name
 * @property {string | null} categoryId
 * @property {string} defaultProcessTemplateId
 * @property {string} departmentId
 * @property {string} ownerId
 * @property {string} description
 * @property {string} completionStandard
 * @property {TaskImportanceValue} importance
 * @property {TaskUrgencyValue} urgency
 * @property {boolean} needAcceptance
 * @property {string | null} accepterId
 * @property {TaskTemplateStatusValue} status
 * @property {TaskTemplateFormField[]} formFields
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Content schedule keeps the old scheduler fields and adds lightweight links
 * to the current goal/task/process loop.
 *
 * @typedef {object} ContentSchedule
 * @property {string} id
 * @property {string} publishDate
 * @property {string} account
 * @property {string} contentType
 * @property {string} contentPurpose
 * @property {string} targetAudience
 * @property {string} product
 * @property {string} productImage
 * @property {string} title
 * @property {string} copywriting
 * @property {string} scene
 * @property {string} hashtags
 * @property {ContentScheduleStatusValue} status
 * @property {string} goalId
 * @property {string | null} taskId
 * @property {string | null} processInstanceId
 * @property {string | null} workPlanId
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ProcessTemplate
 * @property {string} id
 * @property {string} name
 * @property {string | null} categoryId
 * @property {string} purpose
 * @property {string[]} applicableDepartmentIds
 * @property {string} ownerId
 * @property {string} startCondition
 * @property {string} completionCondition
 * @property {string} overallStandard
 * @property {ProcessTemplateStatusValue} status
 * @property {number} version
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ProcessTemplateNode
 * @property {string} id
 * @property {string} templateId
 * @property {string} stageName
 * @property {number} stageOrder
 * @property {number} nodeOrder
 * @property {string} name
 * @property {ProcessOwnerRuleValue} ownerRule
 * @property {string | null} ownerDepartmentId
 * @property {string | null} ownerPositionId
 * @property {string | null} defaultOwnerId
 * @property {number} durationDays
 * @property {string} description
 * @property {string} completionStandard
 * @property {string | null} reviewStandard
 * @property {TaskImportanceValue} defaultImportance
 * @property {TaskUrgencyValue} defaultUrgency
 * @property {boolean} needAcceptance
 * @property {ProcessAccepterRuleValue} accepterRule
 * @property {string | null} defaultAccepterId
 * @property {string} outputRequirement
 * @property {ProcessTemplateNodeStatusValue} status
 * @property {SubmitTypeValue} submitType
 * @property {string | null} submitDescription
 * @property {SubmitField[]} submitFields
 * @property {boolean} requireFile
 * @property {boolean} requireLink
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ProcessInstance
 * @property {string} id
 * @property {string} templateId
 * @property {string | null} taskTemplateId
 * @property {number} templateVersion
 * @property {string} name
 * @property {string} goalId
 * @property {string} initiatorId
 * @property {string} description
 * @property {ProcessInstanceStatusValue} status
 * @property {string} startedAt
 * @property {string | null} completedAt
 * @property {string | null} stoppedAt
 * @property {Record<string, string | string[]>} customFields
 * @property {string | null} displayTitle
 * @property {string | null} coverImageUrl
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} WorkPlan
 * @property {string} id
 * @property {string} goalId
 * @property {string} departmentId
 * @property {string} taskTemplateId
 * @property {string | null} title
 * @property {Record<string, unknown>} customFields
 * @property {string | null} coverImageUrl
 * @property {TaskImportanceValue} importance
 * @property {TaskUrgencyValue} urgency
 * @property {WorkPlanStatusValue} status
 * @property {string | null} plannedWeek
 * @property {string | null} dueDate
 * @property {string | null} description
 * @property {string | null} processInstanceId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} launchedAt
 * @property {string | null} canceledAt
 */

export {};
