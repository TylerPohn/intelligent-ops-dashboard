# Deploying Frontend to Vercel - Complete Guide

## 📋 What You Need

### 1. Vercel Account (Free)
- Sign up at: https://vercel.com/signup
- Choose "Continue with GitHub" (recommended) or use email
- Free plan includes:
  - Unlimited deployments
  - Automatic HTTPS
  - Custom domains
  - 100GB bandwidth/month

### 2. Environment Variables
Already configured in `frontend/.env`:
```bash
VITE_API_URL=https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod
VITE_WEBSOCKET_URL=wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod
```

---

## 🚀 Option 1: Deploy via Vercel Dashboard (Easiest)

### Step 1: Push to GitHub
```bash
cd /Users/tyler/Desktop/Gauntlet/iops-dashboard

# Initialize git (if not already done)
git init
git add .
git commit -m "Initial commit: IOPS Dashboard"

# Create GitHub repo and push
# Go to https://github.com/new
# Create repo named "iops-dashboard"
# Then:
git remote add origin https://github.com/YOUR_USERNAME/iops-dashboard.git
git branch -M main
git push -u origin main
```

### Step 2: Import to Vercel
1. Go to https://vercel.com/new
2. Click "Import Git Repository"
3. Select your `iops-dashboard` repo
4. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

### Step 3: Add Environment Variables
In Vercel dashboard:
1. Go to Project Settings → Environment Variables
2. Add these variables:
   ```
   VITE_API_URL = https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod
   VITE_WEBSOCKET_URL = wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod
   VITE_AWS_REGION = us-east-2
   ```

### Step 4: Deploy
1. Click "Deploy"
2. Wait ~2 minutes for build
3. Get your live URL: `https://iops-dashboard-xxxxx.vercel.app`

**✅ Done! Your frontend is now live and accessible to anyone.**

---

## 🚀 Option 2: Deploy via Vercel CLI (Faster)

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Login to Vercel
```bash
vercel login
```

This will:
1. Open browser
2. Ask you to sign in
3. Authenticate the CLI

### Step 3: Deploy
```bash
cd /Users/tyler/Desktop/Gauntlet/iops-dashboard/frontend
vercel
```

**First deployment prompts**:
```
? Set up and deploy "~/Desktop/Gauntlet/iops-dashboard/frontend"? [Y/n] Y
? Which scope do you want to deploy to? Your Username
? Link to existing project? [y/N] N
? What's your project's name? iops-dashboard
? In which directory is your code located? ./
```

**Auto-detected settings**:
```
Auto-detected Project Settings (Vite):
- Build Command: vite build
- Output Directory: dist
- Development Command: vite --port $PORT
```

Press Enter to accept.

### Step 4: Set Environment Variables
```bash
vercel env add VITE_API_URL production
# Paste: https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod

vercel env add VITE_WEBSOCKET_URL production
# Paste: wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod

vercel env add VITE_AWS_REGION production
# Paste: us-east-2
```

### Step 5: Deploy to Production
```bash
vercel --prod
```

**Output**:
```
🔍  Inspect: https://vercel.com/your-username/iops-dashboard/xxxxx
✅  Production: https://iops-dashboard.vercel.app [2m]
```

**✅ Done! Your app is live at the Production URL.**

---

## 🔧 Configuration Files

### Create `vercel.json` (Optional)
```bash
cd /Users/tyler/Desktop/Gauntlet/iops-dashboard/frontend
cat > vercel.json << 'EOF'
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/:path*"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    }
  ]
}
EOF
```

This adds:
- API proxy (optional, for CORS issues)
- Security headers
- Explicit build configuration

---

## 🔄 Continuous Deployment

### Automatic Deploys on Git Push
Once linked to GitHub, Vercel automatically:
1. Watches your `main` branch
2. Rebuilds on every push
3. Deploys to production
4. Creates preview URLs for PRs

**No manual deploys needed after initial setup!**

---

## 🌐 Custom Domain (Optional)

### Step 1: Add Domain in Vercel
1. Go to Project Settings → Domains
2. Click "Add"
3. Enter your domain: `dashboard.yourcompany.com`

### Step 2: Configure DNS
Add these DNS records at your domain provider:

**For subdomain (recommended)**:
```
Type: CNAME
Name: dashboard
Value: cname.vercel-dns.com
```

**For root domain**:
```
Type: A
Name: @
Value: 76.76.21.21

Type: A
Name: @
Value: 76.76.21.98
```

### Step 3: Wait for SSL
Vercel automatically provisions SSL certificate (~5 minutes)

**✅ Your dashboard is now at: https://dashboard.yourcompany.com**

---

## 📊 What You Get with Vercel (Free Tier)

| Feature | Free Tier |
|---------|----------|
| Bandwidth | 100 GB/month |
| Build Time | 6,000 minutes/month |
| Deployments | Unlimited |
| Domains | Unlimited custom domains |
| SSL | Automatic (Let's Encrypt) |
| Global CDN | 70+ edge locations |
| DDoS Protection | Included |
| Preview Deploys | Unlimited (for PRs) |
| Analytics | Basic (pageviews) |

**Paid ($20/month) adds**:
- Commercial use
- Team collaboration
- Advanced analytics
- More bandwidth (1 TB)

---

## 🧪 Test Deployment Locally

Before deploying, test the production build:

```bash
cd frontend

# Build for production
npm run build

# Preview production build locally
npm run preview
# Visit: http://localhost:4173
```

This simulates exactly what Vercel will deploy.

---

## 🐛 Troubleshooting

### Build Fails
```bash
# Check build locally first
cd frontend
npm run build

# If successful locally but fails on Vercel:
# - Check Node.js version (Vercel uses Node 20 by default)
# - Verify all dependencies in package.json
# - Check build logs in Vercel dashboard
```

### Environment Variables Not Working
```bash
# Verify they're set
vercel env ls

# Pull env vars to local
vercel env pull .env.local

# Redeploy with fresh env
vercel --prod
```

### API CORS Errors
If you get CORS errors, you have 2 options:

**Option 1**: Add CORS headers in API Gateway (on AWS side)

**Option 2**: Use Vercel proxy (add to `vercel.json` rewrites)

### WebSocket Not Connecting
WebSocket connections work differently:
- Development (local): Direct connection
- Production (Vercel): May need proxy or direct AWS connection

Verify WebSocket URL in production:
```javascript
// frontend/src/hooks/useWebSocket.ts
const wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
// Should be: wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod
```

---

## 📱 Mobile Responsive

Vercel automatically serves your Vite app with:
- Responsive viewport
- Mobile-optimized assets
- Touch-friendly UI (thanks to Material-UI)

Test on mobile:
1. Deploy to Vercel
2. Visit URL on phone
3. All MUI components are responsive by default

---

## 🔒 Security Best Practices

### 1. Environment Variables
✅ Never commit `.env` to git (already in `.gitignore`)
✅ Use Vercel environment variables for production
✅ Keep API URLs in environment variables only

### 2. API Security
- API Gateway has throttling enabled (1000 req/sec burst)
- Consider adding API key authentication
- Monitor CloudWatch for unusual traffic

### 3. WebSocket Security
- WSS (WebSocket Secure) is enabled
- Connections auto-timeout after 24 hours
- DynamoDB TTL cleans up stale connections

---

## 💰 Cost Comparison

### Vercel (Recommended)
- **Free Tier**: $0/month (100 GB bandwidth)
- **Pro Tier**: $20/month (1 TB bandwidth)
- **Enterprise**: Custom pricing

### AWS CloudFront + S3 (Alternative)
- **S3 Storage**: $0.023/GB (~$0.50/month)
- **CloudFront**: $0.085/GB (~$8.50/month for 100GB)
- **Total**: ~$9/month (more setup work)

### Netlify (Alternative)
- **Free Tier**: $0/month (100 GB bandwidth)
- **Pro Tier**: $19/month
- Similar to Vercel

**Recommendation**: Use Vercel for easiest setup and free tier.

---

## 🚀 Quick Deploy Commands

```bash
# One-time setup
npm install -g vercel
vercel login

# Deploy to production
cd frontend
vercel --prod

# Add environment variables
vercel env add VITE_API_URL production
vercel env add VITE_WEBSOCKET_URL production

# Redeploy after changes
git push  # If linked to GitHub (auto-deploys)
# OR
vercel --prod  # Manual deploy
```

---

## ✅ Deployment Checklist

- [ ] Vercel account created
- [ ] Vercel CLI installed (`npm install -g vercel`)
- [ ] Logged in (`vercel login`)
- [ ] Environment variables configured
- [ ] Production build tested locally (`npm run build && npm run preview`)
- [ ] Deployed to Vercel (`vercel --prod`)
- [ ] Live URL accessible
- [ ] WebSocket connection working
- [ ] API calls reaching AWS
- [ ] Email alerts confirmed (SNS subscriptions)
- [ ] Custom domain configured (optional)

---

## 📞 Need Help?

- **Vercel Docs**: https://vercel.com/docs
- **Vite Deployment**: https://vitejs.dev/guide/static-deploy.html
- **Support**: https://vercel.com/support

---

**Time to Deploy**: ~10 minutes
**Cost**: $0/month (free tier)
**Automatic Updates**: Yes (if GitHub connected)
**SSL**: Automatic
**Global CDN**: Included
