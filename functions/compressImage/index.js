// dependencies
const async = require("async");
const AWS = require("aws-sdk");
const gm = require("gm").subClass({ imageMagick: true }); // Enable ImageMagick integration.
const util = require("util");

// constants
const MAX_WIDTH = 500;
const MAX_HEIGHT = 500;
const DEFAULT_QUALITY = 90; // try to keep the quality
const DEFAULT_SCALING_FACTOR = 0.8;

// get reference to S3 client
const s3 = new AWS.S3();

exports.handler = function(event, context, callback) {
  // Read options from the event.
  console.log(
    "Reading options from event:\n",
    util.inspect(event, { depth: 5 })
  );
  
  const srcBucket = event.Records[0].s3.bucket.name;

  if (srcBucket !== 'requiem-dashboard-media') {
    callback("Source bucket is not correct.");
    return;
  }
  // Object key may have spaces or unicode non-ASCII characters.
  const srcKey = decodeURIComponent(
    event.Records[0].s3.object.key.replace(/\+/g, " ")
  );

  // Infer the image type.
  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    callback("Could not determine the image type.");
    return;
  }

  const dstBucket = 'everdays-compressed-images';
  const dstKey = srcKey.substr(0, srcKey.lastIndexOf(".")) + ".png";

  // Sanity check: validate that source and destination are different buckets.
  if (srcBucket == dstBucket) {
    callback("Source and destination buckets are the same.");
    return;
  }
  const imageType = typeMatch[1].toLowerCase();

  // Can filter image types
  if (imageType != "jpg" && imageType != "jpeg" && imageType != "png") {
    callback(`Unsupported image type: ${imageType}`);
    return;
  }

  // Download the image from S3, transform, and upload to a different S3 bucket.
  async.waterfall(
    [
      function download(next) {
        // Download the image from S3 into a buffer.
        s3.getObject(
          {
            Bucket: srcBucket,
            Key: srcKey
          },
          next
        );
      },
      function transform(response, next) {
        gm(response.Body).size(function(err, size) {
          if (err) {
            next(err);
            return;
          }
          // Infer the scaling factor to avoid stretching the image unnaturally.
          let scalingFactor = Math.min(
            MAX_WIDTH / size.width,
            MAX_HEIGHT / size.height
          );
          
          if (scalingFactor >= 1) scalingFactor = Math.min(DEFAULT_SCALING_FACTOR, scalingFactor);
          
          const width = scalingFactor * size.width;
          const height = scalingFactor * size.height;

          // Transform the image buffer in memory.
          this
            .resize(width, height)
            .quality(DEFAULT_QUALITY)
            .toBuffer(function(err, buffer) {
              if (err) {
                next(err);
              } else {
                next(null, response.ContentType, buffer);
              }
            });
        });
      },
      function upload(contentType, data, next) {
        // Stream the transformed image to a different S3 bucket.
        s3.putObject(
          {
            Bucket: dstBucket,
            Key: dstKey,
            Body: data,
            ContentType: contentType
          },
          next
        );
      }
    ],
    function(err) {
      if (err) {
        console.error(
          `Unable to resize ${srcBucket}/${srcKey} and upload to ${dstBucket}/${dstKey} due to an error: ${err}`
        );
      } else {
        console.log(
          `Successfully resized ${srcBucket}/${srcKey} and uploaded to ${dstBucket}/${dstKey}`
        );
      }

      callback(null, "message");
    }
  );
};
