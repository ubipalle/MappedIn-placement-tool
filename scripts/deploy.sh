#!/bin/bash
set -e

# --- Configuration ---
PROJECT_ID="survey-tool-488114"
REGION="europe-west1"
SERVICE_NAME="camera-placement-tool"
REPO_NAME="placement-tool"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

echo "=== Camera Placement Tool — Cloud Run Deployment ==="
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE_NAME}"
echo ""

# 1. Check gcloud auth
echo "--- Checking gcloud auth ---"
gcloud auth print-access-token > /dev/null 2>&1 || {
  echo "Not authenticated. Run: gcloud auth login"
  exit 1
}
gcloud config set project ${PROJECT_ID}

# 2. Enable required APIs
echo "--- Enabling APIs ---"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iap.googleapis.com \
  run.googleapis.com \
  cloudresourcemanager.googleapis.com

# 3. Create Artifact Registry repo (if not exists)
echo "--- Ensuring Artifact Registry repo ---"
gcloud artifacts repositories describe ${REPO_NAME} \
  --location=${REGION} > /dev/null 2>&1 || \
gcloud artifacts repositories create ${REPO_NAME} \
  --repository-format=docker \
  --location=${REGION} \
  --description="Camera Placement Tool"

# 4. Configure Docker auth for Artifact Registry
echo "--- Configuring Docker auth ---"
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# 5. Build and push Docker image
echo "--- Building Docker image ---"
docker build -t ${IMAGE_NAME}:latest .

echo "--- Pushing to Artifact Registry ---"
docker push ${IMAGE_NAME}:latest

# 6. Deploy to Cloud Run with IAP enabled
echo "--- Deploying to Cloud Run with IAP ---"
gcloud beta run deploy ${SERVICE_NAME} \
  --image=${IMAGE_NAME}:latest \
  --region=${REGION} \
  --platform=managed \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --no-allow-unauthenticated \
  --iap \
  --set-env-vars="MAPPEDIN_API_KEY=${MAPPEDIN_API_KEY},MAPPEDIN_API_SECRET=${MAPPEDIN_API_SECRET},MAPPEDIN_DEFAULT_MAP_ID=${MAPPEDIN_DEFAULT_MAP_ID}"

# 7. Grant IAP service agent invoker role
echo "--- Setting up IAP service agent ---"
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')

gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region=${REGION} \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
  --role=roles/run.invoker

echo ""
echo "=== Deployment complete ==="
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "=== Next: Grant access to your team ==="
echo ""
echo "Grant access to the entire ubiqisense.com domain:"
echo "  gcloud beta iap web add-iam-policy-binding \\"
echo "    --resource-type=cloud-run \\"
echo "    --service=${SERVICE_NAME} \\"
echo "    --region=${REGION} \\"
echo "    --member=domain:ubiqisense.com \\"
echo "    --role=roles/iap.httpsResourceAccessor \\"
echo "    --condition=None"
echo ""
echo "Or grant access to a specific user:"
echo "  gcloud beta iap web add-iam-policy-binding \\"
echo "    --resource-type=cloud-run \\"
echo "    --service=${SERVICE_NAME} \\"
echo "    --region=${REGION} \\"
echo "    --member=user:alice@ubiqisense.com \\"
echo "    --role=roles/iap.httpsResourceAccessor \\"
echo "    --condition=None"
