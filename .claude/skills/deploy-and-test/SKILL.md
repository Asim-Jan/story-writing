---
name: deploy-and-test
description: Deploys changes to production and guides through systematic testing. Use this AFTER committing changes and BEFORE creating a PR. This is part of the deploy-then-PR workflow.
allowed-tools: [Write, Terminal]
---

# Deploy and Test

Deploys changes to production and guides through testing. **CRITICAL: This must happen BEFORE creating a PR!**

## When to Use This Skill

- Changes are committed to feature branch
- Changes are pushed to remote
- Ready to test in production
- **BEFORE creating a pull request**

## Prerequisites

- ✅ Changes committed to feature branch (NOT main)
- ✅ Feature branch pushed to remote
- ✅ AWS credentials configured
- ✅ Docker running and configured

## Deploy-Then-PR Workflow

**The correct workflow is:**
1. ✅ Deploy changes to production (on feature branch)
2. ✅ Test in production
3. ✅ **Wait for user confirmation**
4. ✅ Create PR only after confirmation

## Deployment Commands

### Deploy Backend Only

```bash
./deploy.sh backend patch
```

### Deploy Frontend Only

```bash
./deploy.sh frontend patch
```

### Deploy Both

```bash
./deploy.sh all patch
```

### Version Types

- `patch` - Bug fixes (2.2.1 → 2.2.2)
- `minor` - New features (2.2.0 → 2.3.0)
- `major` - Breaking changes (2.0.0 → 3.0.0)

## Steps

### 1. Verify Current State

```bash
git branch  # MUST be on feature branch, NOT main!
git status  # Should be clean (all changes committed)
git log -1  # Verify last commit is correct
```

### 2. Run Deployment

```bash
# Choose appropriate command based on what changed
./deploy.sh backend patch
# or
./deploy.sh all patch
```

### 3. Wait for ECS Stabilization

**CRITICAL: Wait 60-90 seconds for ECS health checks to pass!**

The deployment script will push images to ECR and trigger ECS updates. Give ECS time to:
- Pull new images
- Start new tasks
- Run health checks
- Stop old tasks

### 4. Monitor Deployment Status

```bash
# Check backend service status
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments[*].{status:status,rolloutState:rolloutState,runningCount:runningCount}'

# Check frontend service status (if deployed)
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-frontend \
  --region eu-west-2 \
  --query 'services[0].deployments[*].{status:status,rolloutState:rolloutState,runningCount:runningCount}'
```

Look for:
- `rolloutState: "COMPLETED"`
- `runningCount` matches desired count

### 5. Check Recent Logs

```bash
# View recent backend logs
aws logs tail /ecs/story-writing-backend --since 2m --region eu-west-2

# Check for errors
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2 | grep -i error
```

### 6. Test in Production

**Go to: https://story-writing.com**

#### Testing Checklist

- [ ] Application loads without errors
- [ ] Can log in successfully
- [ ] Test the specific feature/fix you deployed
- [ ] Verify data persists after page refresh
- [ ] Check browser console for errors (F12 → Console)
- [ ] Test related features to ensure nothing broke
- [ ] Verify no errors in backend logs

#### Browser Console Check

1. Open DevTools: `F12` or Right-click → Inspect
2. Go to Console tab
3. Look for red error messages
4. Clear console and test feature again
5. Verify no new errors appear

### 7. Verify Database (if applicable)

```bash
node scripts/check-db-status.js
```

### 8. Watch Logs During Testing

```bash
# Follow logs in real-time while testing
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

## If Issues Found

### Fix and Re-deploy

1. Make fixes on the same feature branch
2. Commit the fixes
3. Push: `git push`
4. Re-deploy: `./deploy.sh backend patch`
5. Wait 60 seconds
6. Test again

**Repeat until everything works correctly!**

## Success Criteria

- ✅ Deployment completed without errors
- ✅ ECS services show "COMPLETED" rollout state
- ✅ No errors in CloudWatch logs
- ✅ Feature works correctly in production UI
- ✅ Data persists after page refresh (if applicable)
- ✅ No console errors in browser
- ✅ **USER CONFIRMS everything works correctly**

## Next Steps

**CRITICAL: Only proceed AFTER user confirms features work!**

Do NOT create a PR until:
1. You've deployed and tested
2. User has tested the feature
3. User explicitly confirms it works

Then use the `create-pull-request` skill.

## Common Issues

### Deployment Takes Too Long
- Check ECS service events for issues
- Verify Docker images pushed to ECR
- Check task definition is valid

### Feature Not Working
- Check backend logs for errors
- Verify database state
- Check field name mappings
- Ensure feature flags are correct

### Data Not Persisting
- Check API endpoint includes all fields
- Verify database migration ran
- Check field mapping in dataService

## Environment Details

- **Production URL**: https://story-writing.com
- **AWS Region**: eu-west-2
- **Cluster**: story-writing-cluster-sai
- **Backend Service**: story-writing-backend
- **Frontend Service**: story-writing-frontend

