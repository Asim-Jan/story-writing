# AWS Services Management Scripts

These scripts help you **start and stop AWS services** to save costs when you're not actively working on the application.

---

## 🛑 Stop Services (Save Money)

Run this when you're done working for the day:

```bash
./stop-services.sh
```

**What it does:**
- ✅ Stops ECS Backend tasks (no charges)
- ✅ Stops ECS Frontend tasks (no charges)
- ✅ Stops RDS PostgreSQL database (~$15-20/month savings)
- ℹ️  Redis stays running (can't be stopped, only deleted - ~$13/month)
- ℹ️  Load Balancer stays running (~$16/month)

**Cost Savings:** ~$35-50/month by stopping ECS + RDS when not working

---

## 🚀 Start Services (Resume Work)

Run this when you want to start working:

```bash
./start-services.sh
```

**What it does:**
- ✅ Starts RDS PostgreSQL database (waits until available)
- ✅ Starts ECS Backend tasks
- ✅ Starts ECS Frontend tasks
- ⏳ Waits for all services to be healthy

**Time:** Takes ~5-8 minutes total
- RDS: ~5 minutes to become available
- ECS tasks: ~2-3 minutes to start and pass health checks

**Result:** Application accessible at https://storywriting.co.uk

---

## 📊 Check Service Status

Check what's currently running:

```bash
./check-services.sh
```

**Shows:**
- ECS Backend & Frontend status (running/stopped)
- RDS Database status (available/stopped/starting)
- Redis ElastiCache status
- Load Balancer status
- Estimated monthly costs

---

## 💰 Cost Breakdown

### When Services Are Running:
| Service | Monthly Cost | Can Stop? |
|---------|--------------|-----------|
| ECS Fargate (2 tasks) | ~$20-30 | ✅ Yes |
| RDS (t3.micro) | ~$15-20 | ✅ Yes |
| Redis (t2.micro) | ~$13 | ❌ No* |
| Load Balancer | ~$16 | ❌ No** |
| Data Transfer | ~$5-10 | N/A |
| **Total** | **~$69-89/month** | |

*Redis can only be deleted/recreated, not stopped
**Load Balancer needed for DNS routing

### When Services Are Stopped:
| Service | Monthly Cost |
|---------|--------------|
| Redis (t2.micro) | ~$13 |
| Load Balancer | ~$16 |
| **Total** | **~$29/month** |

**Savings:** ~$40-60/month by stopping services when not working

---

## 🔧 Typical Workflow

### End of Day:
```bash
./stop-services.sh
# Services stopped, minimal costs overnight
```

### Start of Day:
```bash
./start-services.sh
# Wait 5-8 minutes
# Application ready at https://storywriting.co.uk
```

### Anytime:
```bash
./check-services.sh
# See what's running
```

---

## ⚠️ Important Notes

### Redis ElastiCache
- **Cannot be stopped** - only deleted
- Costs ~$13/month even when other services are stopped
- Deleting it requires reconfiguring VPC networking when recreating
- Recommendation: Leave it running

### RDS Database
- **Safe to stop** - all data preserved
- Automatically starts after 7 days even if you didn't start it
- Takes ~5 minutes to start
- No data loss when stopped

### ECS Tasks
- **Safe to stop** - just containers, no data
- Start instantly (2-3 minutes)
- No impact on data or configuration

### Load Balancer
- **Should stay running** - handles DNS routing
- Stopping it breaks the https://storywriting.co.uk URL
- Only ~$16/month

---

## 🐛 Troubleshooting

### Services won't start?
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check detailed status
./check-services.sh

# Check ECS task logs
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

### Database taking too long?
```bash
# RDS can take up to 10 minutes to start
# Check status:
aws rds describe-db-instances \
  --db-instance-identifier story-writing-postgres \
  --region eu-west-2 \
  --query 'DBInstances[0].DBInstanceStatus'
```

### Application not loading after start?
- Wait 2-3 more minutes for load balancer health checks
- Check service status: `./check-services.sh`
- Check CloudWatch logs for errors

---

## 📝 Script Details

### stop-services.sh
- Sets ECS desired count to 0
- Stops RDS instance
- Does not stop Redis or Load Balancer
- Runs in ~10 seconds

### start-services.sh
- Starts RDS instance first
- Waits for RDS to be available (required for app to work)
- Starts ECS services
- Waits for services to be stable
- Takes ~5-8 minutes total

### check-services.sh
- Non-destructive - just reads status
- Shows running/stopped state of all services
- Displays estimated costs
- Runs in ~5 seconds

---

## 🎯 Recommended Usage

**Daily Development:**
- Morning: `./start-services.sh` → wait 5-8 min → work
- Evening: `./stop-services.sh` → save money overnight

**Weekend/Vacation:**
- Stop everything before leaving
- Save ~$1-2/day

**Production (24/7):**
- Keep services running
- Full monthly cost: ~$69-89

---

## 🔒 Security Notes

- Scripts use AWS CLI with your configured credentials
- No credentials are stored in scripts
- All operations require AWS authentication
- Scripts only modify service counts and states (no data changes)

---

## 📚 Additional Resources

- AWS ECS Documentation: https://docs.aws.amazon.com/ecs/
- AWS RDS Documentation: https://docs.aws.amazon.com/rds/
- AWS CLI Reference: https://docs.aws.amazon.com/cli/

---

**Created:** 2026-02-15
**Version:** 1.0
**Region:** eu-west-2
