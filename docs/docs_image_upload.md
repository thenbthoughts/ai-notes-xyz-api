# File Upload Structure

## Overview

All files are organized in a structured format:
```
ai-notes-xyz/{username}/{featureType}/{featurePrefix}{entityId}/{subType}/{subPrefix}{subId}.ext
```

## File Path Structure

### Base Path
```
ai-notes-xyz/{username}/
```

### Features

#### Chat (Messages + Comments)
**Messages:**
```
chat/chat-thread-{threadId}/messages/chat-{messageId}.ext
```

**Comments:**
```
chat/chat-thread-{threadId}/comments/chatcomment-{commentId}.ext
```

**Example:**
- `ai-notes-xyz/john123/chat/chat-thread-507f1f77bcf86cd799439011/messages/chat-507f191e810c19729de860ea.pdf`
- `ai-notes-xyz/john123/chat/chat-thread-507f1f77bcf86cd799439011/comments/chatcomment-507f191e810c19729de860ea.png`

#### Task Comments
```
task/task-{taskId}/comments/taskcomment-{commentId}.ext
```

**Example:**
- `ai-notes-xyz/john123/task/task-507f1f77bcf86cd799439011/comments/taskcomment-507f191e810c19729de860ea.pdf`

#### Notes Comments
```
notes/note-{noteId}/comments/notecomments-{commentId}.ext
```

**Example:**
- `ai-notes-xyz/john123/notes/note-507f1f77bcf86cd799439011/comments/notecomments-507f191e810c19729de860ea.jpg`

#### Life Event Comments
```
lifeevent/lifeevent-{lifeEventId}/comments/lifeeventcomment-{commentId}.ext
```

**Example:**
- `ai-notes-xyz/john123/lifeevent/lifeevent-507f1f77bcf86cd799439011/comments/lifeeventcomment-507f191e810c19729de860ea.png`

#### Info Vault Comments
```
infovault/infovault-{vaultId}/comments/vaultcomment-{commentId}.ext
```

**Example:**
- `ai-notes-xyz/john123/infovault/infovault-507f1f77bcf86cd799439011/comments/vaultcomment-507f191e810c19729de860ea.pdf`

## Pattern Breakdown

```
ai-notes-xyz/{username}/{feature}/{prefix}{parentId}/{subType}/{subPrefix}{subId}.ext
```

Where:
- `{username}`: User's username
- `{feature}`: chat, task, notes, lifeevent, infovault
- `{prefix}`: Feature-specific prefix (chat-thread-, task-, note-, etc.)
- `{parentId}`: Parent entity MongoDB ObjectId
- `{subType}`: messages or comments
- `{subPrefix}`: Sub-entity prefix (chat-, taskcomment-, etc.)
- `{subId}`: Sub-entity MongoDB ObjectId
- `.ext`: File extension (.pdf, .jpg, .png, etc.)

## Drive Files (Separate System)

User's personal drive files are stored separately:
```
ai-notes-xyz-drive/{username}/files/...
```

Drive files are managed through the `/api/drive/` endpoints.

## API Endpoints

See `docs/docs_upload_api.md` for complete API documentation.

### Quick Reference:
- Upload: `POST /api/uploads/uploadFile`
- Upload with Comment: `POST /api/uploads/uploadFileAndCreateComment`
- Delete by Entity: `DELETE /api/uploads/deleteFilesByEntity`
- Delete Single: `DELETE /api/uploads/deleteFile`
- Get File: `GET /api/uploads/getFile`

## Migration

See `docs/MIGRATION_UPLOAD.md` for migration guide from old upload system.