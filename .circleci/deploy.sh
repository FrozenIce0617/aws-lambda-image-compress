#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail

current_function="compressImage"
current_build="${current_function}"
cd $current_function

if [ -f package-lock.json ]; then
    npm ci
else
    npm i
fi
zip -r "${current_build}.zip" .
echo "Checking if function $current_build already exists"
functionArn=$(aws lambda list-functions | jq -r --arg CURRENTFUNCTION "$current_build" '.Functions[] | select(.FunctionName==$CURRENTFUNCTION) | .FunctionArn')
if [ -z "$functionArn" ]
then
    echo "Creating function: $current_build"
    functionArn=$(aws lambda create-function --function-name "$current_build" --runtime nodejs8.10 --role arn:aws:iam::$AWS_ACCOUNT_ID:role/lambda-basic-role --handler lambdaCtx.handler --zip-file fileb://./"${current_build}.zip" | jq -r '.FunctionArn')
    if [ -z "$functionArn" ]
    then
        echo "Failed to get functionArn"
        exit 1
    fi
fi
echo "Updating function: $current_build"
aws lambda update-function-code --function-name "$current_build" --zip-file fileb://./"${current_build}.zip" --no-publish
echo "Publishing version"
version=$(aws lambda publish-version --function-name "$current_build" | jq .Version | xargs)
echo "Finished"