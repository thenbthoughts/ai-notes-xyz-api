# Task Schedule API

This API provides CRUD operations for managing task schedules. Task schedules allow users to create automated tasks that can be triggered at specific times or using cron expressions.

## API Endpoints

All endpoints are prefixed with `/api/task-schedule/crud/`

### 1. Create Task Schedule
**POST** `/api/task-schedule/crud/taskScheduleAdd`

Creates a new task schedule.

**Request Body:**
```json
{
  "title": "Daily Task Creation",
  "description": "Automatically create daily tasks",
  "taskType": "taskAdd",
  "isActive": true,
  "shouldSendEmail": false,
  "scheduleTimeArr": ["2024-01-15T09:00:00.000Z"],
  "cronExpressionArr": ["0 9 * * *"]
}
```

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "user123",
  "title": "Daily Task Creation",
  "description": "Automatically create daily tasks",
  "taskType": "taskAdd",
  "isActive": true,
  "shouldSendEmail": false,
  "scheduleTimeArr": ["2024-01-15T09:00:00.000Z"],
  "cronExpressionArr": ["0 9 * * *"],
  "createdAtUtc": "2024-01-01T12:00:00.000Z",
  "updatedAtUtc": "2024-01-01T12:00:00.000Z"
}
```

### 2. Get Task Schedules
**POST** `/api/task-schedule/crud/taskScheduleGet`

Retrieves task schedules with optional filtering.

**Request Body (all optional):**
```json
{
  "recordId": "507f1f77bcf86cd799439011",
  "taskType": "taskAdd",
  "isActive": true,
  "shouldSendEmail": false,
  "title": "search term",
  "description": "search term",
  "limit": 50
}
```

**Response:**
```json
{
  "message": "Task schedules retrieved successfully",
  "count": 1,
  "docs": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "username": "user123",
      "title": "Daily Task Creation",
      "taskType": "taskAdd",
      "isActive": true,
      // ... other fields
    }
  ]
}
```

### 3. Update Task Schedule
**POST** `/api/task-schedule/crud/taskScheduleEdit`

Updates an existing task schedule.

**Request Body:**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "Updated Daily Task Creation",
  "description": "Updated description",
  "taskType": "taskAdd",
  "isActive": false,
  "shouldSendEmail": true,
  "scheduleTimeArr": ["2024-01-15T10:00:00.000Z"],
  "cronExpressionArr": ["0 10 * * *"]
}
```

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "user123",
  "title": "Updated Daily Task Creation",
  // ... updated fields
}
```

### 4. Delete Task Schedule
**POST** `/api/task-schedule/crud/taskScheduleDelete`

Deletes a task schedule.

**Request Body:**
```json
{
  "id": "507f1f77bcf86cd799439011"
}
```

**Response:**
```json
{
  "message": "Task schedule deleted successfully",
  "deletedTaskSchedule": {
    "_id": "507f1f77bcf86cd799439011",
    // ... deleted record details
  }
}
```

### 5. Toggle Active Status
**POST** `/api/task-schedule/crud/taskScheduleToggleActive`

Quickly toggles the active status of a task schedule.

**Request Body:**
```json
{
  "id": "507f1f77bcf86cd799439011"
}
```

**Response:**
```json
{
  "message": "Task schedule activated successfully",
  "taskSchedule": {
    "_id": "507f1f77bcf86cd799439011",
    "isActive": true,
    // ... other fields
  }
}
```

## Task Types

The following task types are supported:

- `taskAdd` - Create new tasks
- `notesAdd` - Create new notes
- `customRestApiCall` - Make custom REST API calls (future feature)
- `customAiSummary` - Generate AI summaries
- `customAiTaskList` - Generate AI task lists

## Cron Expression Format

Cron expressions should follow the standard 5 or 6 field format:

```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └── day of week (0 - 7) (Sunday = 0 or 7)
│ │ │ │ └──── month (1 - 12)
│ │ │ └────── day of month (1 - 31)
│ │ └──────── hour (0 - 23)
│ └────────── minute (0 - 59)
└──────────── second (0 - 59) [optional]
```

Examples:
- `0 9 * * *` - Every day at 9:00 AM
- `0 0 * * 0` - Every Sunday at midnight
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * 1-5` - Every weekday at 9:00 AM

## Authentication

All endpoints require user authentication. The authentication middleware extracts the username from the request and ensures users can only access their own task schedules.

## Error Responses

All endpoints return appropriate HTTP status codes and error messages:

- `400` - Bad Request (validation errors)
- `401` - Unauthorized (authentication required)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

Example error response:
```json
{
  "message": "Valid task type is required. Must be one of: taskAdd, notesAdd, customRestApiCall, customAiSummary, customAiTaskList"
}
```