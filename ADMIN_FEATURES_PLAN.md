# Admin Dashboard Enhancement Plan

**Project**: Story Writing Studio - Admin Features Enhancement
**Created**: 2026-01-31
**Status**: Planning Phase

---

## Overview

This document tracks the implementation of comprehensive admin features for the Story Writing Studio platform.

---

## Feature Categories

### 1. Enhanced User Management

#### 1.1 Bulk User Operations
- [ ] **Backend**: Add bulk tier change endpoint `POST /api/admin/users/bulk/tier`
- [ ] **Backend**: Add bulk suspend endpoint `POST /api/admin/users/bulk/suspend`
- [ ] **Backend**: Add bulk activate endpoint `POST /api/admin/users/bulk/activate`
- [ ] **Frontend**: Add user selection checkboxes in Users tab
- [ ] **Frontend**: Add bulk action dropdown/buttons
- [ ] **Frontend**: Add confirmation modal for bulk operations
- [ ] **Database**: Ensure audit logging captures bulk operations

#### 1.2 User Activity History
- [ ] **Database**: Create `user_activity_log` table
  - Columns: id, user_id, activity_type, details (JSONB), ip_address, user_agent, created_at
- [ ] **Backend**: Add activity logging middleware
- [ ] **Backend**: Add endpoint `GET /api/admin/users/:userId/activity`
- [ ] **Frontend**: Add "View Activity" button in user actions
- [ ] **Frontend**: Create activity history modal/drawer

#### 1.3 User Login History
- [ ] **Database**: Create `login_history` table
  - Columns: id, user_id, login_at, ip_address, user_agent, success (boolean), failure_reason
- [ ] **Backend**: Update login endpoint to log attempts
- [ ] **Backend**: Add endpoint `GET /api/admin/users/:userId/login-history`
- [ ] **Frontend**: Add "Login History" tab in user detail view
- [ ] **Frontend**: Display login attempts with success/failure indicators

#### 1.4 Delete User Accounts
- [ ] **Backend**: Add endpoint `DELETE /api/admin/users/:userId` (hard delete)
- [ ] **Backend**: Add cascade delete logic (user_settings, books, chapters, etc.)
- [ ] **Backend**: Add audit logging for deletions
- [ ] **Frontend**: Add "Delete User" action with strong confirmation
- [ ] **Frontend**: Show warning about data loss
- [ ] **Database**: Ensure foreign key constraints handle cascading

---

### 2. System Monitoring

#### 2.1 Real-time System Health Metrics
- [ ] **Backend**: Create health check endpoint `GET /api/admin/system/health`
  - Database connection status
  - Redis connection status
  - Disk space usage
  - Memory usage
  - CPU usage
- [ ] **Backend**: Add endpoint `GET /api/admin/system/metrics`
- [ ] **Frontend**: Create "System" tab in admin dashboard
- [ ] **Frontend**: Add health status cards with indicators
- [ ] **Frontend**: Auto-refresh metrics every 30 seconds

#### 2.2 API Request Rate Monitoring
- [ ] **Database**: Create `api_metrics` table
  - Columns: id, endpoint, method, count, avg_response_time, created_at (hourly aggregates)
- [ ] **Backend**: Add API metrics middleware to track requests
- [ ] **Backend**: Add aggregation job to summarize hourly data
- [ ] **Backend**: Add endpoint `GET /api/admin/metrics/api-requests`
- [ ] **Frontend**: Add API metrics chart (requests per hour)
- [ ] **Frontend**: Add endpoint breakdown table

#### 2.3 Database Performance Metrics
- [ ] **Backend**: Add endpoint `GET /api/admin/metrics/database`
  - Query for table sizes
  - Query for slow queries log
  - Connection pool stats
- [ ] **Frontend**: Display database size by table
- [ ] **Frontend**: Show slow query log

#### 2.4 Error Rate Tracking
- [ ] **Database**: Create `error_log` table
  - Columns: id, error_type, error_message, stack_trace, endpoint, user_id, created_at
- [ ] **Backend**: Add global error handler to log errors
- [ ] **Backend**: Add endpoint `GET /api/admin/errors`
- [ ] **Frontend**: Add "Errors" tab showing recent errors
- [ ] **Frontend**: Add error charts (errors per hour)
- [ ] **Frontend**: Add error filtering by type/endpoint

---

### 3. Content Management

#### 3.1 View All Books Across All Users
- [ ] **Backend**: Add endpoint `GET /api/admin/books`
  - Pagination support
  - Search by title/author
  - Filter by user, date, status
- [ ] **Frontend**: Create "Books" tab in admin dashboard
- [ ] **Frontend**: Add books table with owner info
- [ ] **Frontend**: Add search and filter controls
- [ ] **Frontend**: Add "View Book" action to open book details

#### 3.2 Moderate/Review Flagged Content
- [ ] **Database**: Create `content_flags` table
  - Columns: id, content_type (book/chapter), content_id, flagged_by_user_id, reason, status, reviewed_by_admin_id, reviewed_at
- [ ] **Backend**: Add endpoint `POST /api/content/flag` (user-facing)
- [ ] **Backend**: Add endpoint `GET /api/admin/flagged-content`
- [ ] **Backend**: Add endpoint `PUT /api/admin/flagged-content/:id/review`
- [ ] **Frontend**: Add "Flagged Content" section in admin
- [ ] **Frontend**: Add review/approve/dismiss actions

#### 3.3 Delete Inappropriate Content
- [ ] **Backend**: Add endpoint `DELETE /api/admin/books/:bookId`
- [ ] **Backend**: Add endpoint `DELETE /api/admin/chapters/:chapterId`
- [ ] **Backend**: Add audit logging for content deletion
- [ ] **Frontend**: Add "Delete" action in books table
- [ ] **Frontend**: Add confirmation with reason input

#### 3.4 View Book Statistics
- [ ] **Backend**: Add endpoint `GET /api/admin/stats/books`
  - Total books
  - Books by genre
  - Average word count
  - Books created per day/week
- [ ] **Frontend**: Add book statistics cards
- [ ] **Frontend**: Add genre distribution chart

---

### 4. Quota Management

#### 4.1 View Detailed Quota Usage Across All Users
- [ ] **Backend**: Add endpoint `GET /api/admin/quotas/overview`
  - Aggregate quota usage by tier
  - Users approaching limits
  - Quota violation attempts
- [ ] **Frontend**: Create "Quotas" tab in admin dashboard
- [ ] **Frontend**: Add quota usage charts
- [ ] **Frontend**: Add "Users Near Limits" section

#### 4.2 Set Custom Quotas for Specific Users
- [ ] **Database**: Add `custom_quotas` column to quotas table (boolean flag)
- [ ] **Backend**: Add endpoint `PUT /api/admin/users/:userId/quotas`
- [ ] **Backend**: Update quota enforcement to check custom flag
- [ ] **Frontend**: Add "Custom Quotas" button in user actions
- [ ] **Frontend**: Create custom quota editor modal

#### 4.3 View Quota Violation Attempts
- [ ] **Database**: Create `quota_violations` table
  - Columns: id, user_id, quota_type, attempted_value, limit, created_at
- [ ] **Backend**: Update quota middleware to log violations
- [ ] **Backend**: Add endpoint `GET /api/admin/quota-violations`
- [ ] **Frontend**: Add violations table showing attempts
- [ ] **Frontend**: Add filtering by user/quota type

#### 4.4 Reset Quota Counters
- [ ] **Backend**: Add endpoint `POST /api/admin/users/:userId/quotas/reset`
  - Reset daily AI requests
  - Optionally reset all counters
- [ ] **Frontend**: Add "Reset Quotas" action
- [ ] **Frontend**: Add confirmation modal with options

---

### 5. Analytics Dashboard

#### 5.1 User Growth Charts
- [ ] **Backend**: Add endpoint `GET /api/admin/analytics/user-growth`
  - Daily/weekly/monthly new users
  - Active users over time
- [ ] **Frontend**: Create "Analytics" tab
- [ ] **Frontend**: Add user growth line chart
- [ ] **Frontend**: Add time range selector (7d, 30d, 90d, 1y)

#### 5.2 Usage Trends Over Time
- [ ] **Backend**: Add endpoint `GET /api/admin/analytics/usage-trends`
  - Books created over time
  - Words written over time
  - AI requests over time
- [ ] **Frontend**: Add multi-line chart for usage metrics
- [ ] **Frontend**: Add metric selector checkboxes

#### 5.3 Popular Features Tracking
- [ ] **Database**: Create `feature_usage` table
  - Columns: id, feature_name, user_id, used_at
- [ ] **Backend**: Add feature usage tracking throughout app
- [ ] **Backend**: Add endpoint `GET /api/admin/analytics/features`
- [ ] **Frontend**: Add feature popularity chart
- [ ] **Frontend**: Add feature usage table

#### 5.4 Revenue Metrics (Future - Stripe Integration)
- [ ] **Database**: Create `subscriptions` table
- [ ] **Database**: Create `payments` table
- [ ] **Backend**: Integrate Stripe webhooks
- [ ] **Backend**: Add endpoint `GET /api/admin/analytics/revenue`
- [ ] **Frontend**: Add revenue charts (MRR, churn, etc.)
- [ ] **Frontend**: Add subscription breakdown

---

### 6. Admin Role Management

#### 6.1 Create/Revoke Admin Access
- [ ] **Backend**: Add endpoint `PUT /api/admin/users/:userId/role`
  - Support: user, admin, superadmin
- [ ] **Backend**: Add self-modification prevention
- [ ] **Frontend**: Add "Grant Admin" / "Revoke Admin" actions
- [ ] **Frontend**: Add confirmation modal
- [ ] **Database**: Ensure only superadmins can grant admin

#### 6.2 Different Admin Permission Levels
- [ ] **Database**: Create `admin_permissions` table
  - Columns: id, admin_user_id, permission_name, granted_at
- [ ] **Backend**: Add permission check middleware
- [ ] **Backend**: Define permission constants (view_users, edit_users, delete_users, etc.)
- [ ] **Frontend**: Add permission editor for admins
- [ ] **Frontend**: Show/hide features based on permissions

#### 6.3 Admin Activity Log
- [ ] **Database**: Already exists (`admin_audit_log`)
- [ ] **Backend**: Ensure all admin actions are logged
- [ ] **Frontend**: Enhance Audit Log tab with better filtering
- [ ] **Frontend**: Add export audit log feature

---

### 7. System Configuration

#### 7.1 Update Tier Quota Limits Globally
- [ ] **Database**: Create `system_config` table
  - Columns: id, config_key, config_value (JSONB), updated_by_admin_id, updated_at
- [ ] **Backend**: Add endpoint `GET /api/admin/config/tier-quotas`
- [ ] **Backend**: Add endpoint `PUT /api/admin/config/tier-quotas`
- [ ] **Backend**: Update quota system to read from database instead of hardcoded
- [ ] **Frontend**: Create "Configuration" tab
- [ ] **Frontend**: Add tier quota editor with inputs for each tier

#### 7.2 Feature Flags Management
- [ ] **Database**: Create `feature_flags` table
  - Columns: id, flag_name, enabled, description, updated_by_admin_id, updated_at
- [ ] **Backend**: Add feature flag middleware
- [ ] **Backend**: Add endpoint `GET /api/admin/config/feature-flags`
- [ ] **Backend**: Add endpoint `PUT /api/admin/config/feature-flags/:flagName`
- [ ] **Frontend**: Add feature flags toggle list
- [ ] **Frontend**: Add descriptions for each flag

#### 7.3 System Announcements/Notifications
- [ ] **Database**: Create `announcements` table
  - Columns: id, title, message, type (info/warning/error), active, show_from, show_until, created_by_admin_id
- [ ] **Backend**: Add endpoint `GET /api/announcements` (user-facing)
- [ ] **Backend**: Add endpoint `POST /api/admin/announcements`
- [ ] **Backend**: Add endpoint `PUT /api/admin/announcements/:id`
- [ ] **Frontend**: Display active announcements banner on user side
- [ ] **Frontend**: Add announcements manager in admin

---

## Implementation Priority

### Phase 1: Essential Admin Features (Week 1)
1. Enhanced User Management (1.1 - 1.4)
2. Content Management (3.1, 3.3)
3. Quota Management (4.1, 4.2)

### Phase 2: Monitoring & Analytics (Week 2)
1. System Monitoring (2.1, 2.4)
2. Analytics Dashboard (5.1, 5.2)
3. API Request Monitoring (2.2)

### Phase 3: Advanced Features (Week 3)
1. Admin Role Management (6.1, 6.2)
2. System Configuration (7.1, 7.2)
3. Feature Flags (7.2)

### Phase 4: Polish & Optimization (Week 4)
1. Content Moderation (3.2)
2. Database Performance Metrics (2.3)
3. Popular Features Tracking (5.3)
4. System Announcements (7.3)

### Phase 5: Future Enhancements
1. Revenue Metrics (5.4) - Requires Stripe integration
2. Advanced permissions system
3. Email notification system
4. Automated report generation

---

## Technical Considerations

### Database Migrations Required
- [ ] `user_activity_log` table
- [ ] `login_history` table
- [ ] `api_metrics` table
- [ ] `error_log` table
- [ ] `content_flags` table
- [ ] `quota_violations` table
- [ ] `feature_usage` table
- [ ] `admin_permissions` table
- [ ] `system_config` table
- [ ] `feature_flags` table
- [ ] `announcements` table
- [ ] Add `custom_quotas` column to quotas table

### Backend Components
- [ ] Create admin middleware for permission checks
- [ ] Create metrics collection service
- [ ] Create audit logging service
- [ ] Create notification service
- [ ] Update rate limiting for admin endpoints

### Frontend Components
- [ ] Create reusable chart components
- [ ] Create bulk action components
- [ ] Create modal/drawer components for details
- [ ] Create permission-aware navigation
- [ ] Add loading states and error handling

### Security Considerations
- [ ] Ensure all admin endpoints require admin role
- [ ] Add CSRF protection for admin actions
- [ ] Implement permission-based access control
- [ ] Add rate limiting for sensitive admin actions
- [ ] Log all admin activities for audit trail
- [ ] Add IP whitelisting option for admin access

---

## Success Criteria

- [ ] All admin features accessible and functional
- [ ] Comprehensive audit logging of all admin actions
- [ ] Real-time system monitoring and alerts
- [ ] Intuitive UI for managing users and content
- [ ] Performance metrics visible and actionable
- [ ] Role-based access control implemented
- [ ] No breaking changes to existing functionality
- [ ] All features tested in production

---

## Notes

- Follow the existing workflow: feature branch → deploy → test → confirm → PR
- Each major feature should be its own PR after testing
- Update CHANGELOG.md with each feature deployment
- Document new API endpoints in API documentation
- Add tests for critical admin functions

---

## Progress Tracking

**Current Phase**: Planning Complete
**Started**: 2026-01-31
**Target Completion**: TBD

### Completed Features
- ✅ Basic admin dashboard (already implemented)
- ✅ User tier management (already implemented)
- ✅ Basic audit log (already implemented)

### In Progress
- Nothing yet - awaiting user approval to begin

### Blocked
- None

---

## Questions & Decisions

1. **Priority**: Which phase should we start with? (Recommend Phase 1)
2. **Stripe Integration**: Do you want to implement payments now or later?
3. **Permissions**: Do you need granular permissions, or is admin/superadmin sufficient?
4. **Notifications**: Email notifications for admin actions, or just in-app?

---

**Last Updated**: 2026-01-31
