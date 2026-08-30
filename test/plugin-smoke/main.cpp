#include "dataengineinterface.h"

#include <QCoreApplication>
#include <QDebug>
#include <QPluginLoader>

#include <cmath>

namespace {

int fail(const QString &message, int code)
{
    qCritical().noquote() << message;
    return code;
}

bool equals(float actual, float expected)
{
    return std::fabs(actual - expected) < 0.0001f;
}

} // namespace

int main(int argc, char *argv[])
{
    QCoreApplication application(argc, argv);
    if (application.arguments().size() != 2)
        return fail(QStringLiteral("usage: plugin-smoke <custom-engine.dll>"), 2);

    QPluginLoader loader(application.arguments().at(1));
    const QString iid = loader.metaData().value(QStringLiteral("IID")).toString();
    if (iid != QStringLiteral("VOFA+.Plugin.CustomFloat"))
        return fail(QStringLiteral("unexpected plugin IID: %1").arg(iid), 4);

    QObject *plugin = loader.instance();
    if (!plugin)
        return fail(QStringLiteral("plugin load failed: %1").arg(loader.errorString()), 5);

    if (QString::fromLatin1(plugin->metaObject()->className()) != QStringLiteral("CustomFloat"))
        return fail(QStringLiteral("plugin class was not independently renamed"), 6);

    DataEngineInterface *engine = qobject_cast<DataEngineInterface *>(plugin);
    if (!engine)
        return fail(QStringLiteral("plugin does not implement DataEngineInterface"), 7);

    // counter16=0x1234, status8=0x56, flags=0xA5, followed by JustFloat tail.
    char validFrame[] = {
        char(0x34), char(0x12), char(0x56), char(0xA5),
        char(0x00), char(0x00), char(0x80), char(0x7F)
    };
    engine->ProcessingDatas(validFrame, int(sizeof(validFrame)));
    const QList<Frame> validFrames = engine->frame_list();
    if (validFrames.size() != 1 || !validFrames.first().is_valid_)
        return fail(QStringLiteral("valid packed frame was rejected"), 8);

    const QVector<float> actual = validFrames.first().datas_;
    const QVector<float> expected = {
        4660.0f, 86.0f,
        1.0f, 0.0f, 1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 1.0f
    };
    if (actual.size() != expected.size())
        return fail(QStringLiteral("channel count mismatch: got %1, expected %2")
                    .arg(actual.size()).arg(expected.size()), 9);
    for (int i = 0; i < expected.size(); ++i) {
        if (!equals(actual.at(i), expected.at(i)))
            return fail(QStringLiteral("ch%1 mismatch: got %2, expected %3")
                        .arg(i).arg(actual.at(i)).arg(expected.at(i)), 10);
    }

    // A configured one-word engine keeps later Words as ordinary JustFloat values.
    char extendedFrame[] = {
        char(0x34), char(0x12), char(0x56), char(0xA5),
        char(0x00), char(0x00), char(0x20), char(0x40), // 2.5f
        char(0x00), char(0x00), char(0x80), char(0x7F)
    };
    engine->ProcessingDatas(extendedFrame, int(sizeof(extendedFrame)));
    const QList<Frame> extendedFrames = engine->frame_list();
    if (extendedFrames.size() != 1 || !extendedFrames.first().is_valid_)
        return fail(QStringLiteral("extended JustFloat frame was rejected"), 11);
    const QVector<float> extendedValues = extendedFrames.first().datas_;
    if (extendedValues.size() != expected.size() + 1 || !equals(extendedValues.last(), 2.5f))
        return fail(QStringLiteral("later Word did not fall back to float"), 12);

    // The payload must still contain every configured Word before the frame tail.
    char tooShortFrame[] = {
        char(0x00), char(0x00), char(0x80), char(0x7F)
    };
    engine->ProcessingDatas(tooShortFrame, int(sizeof(tooShortFrame)));
    const QList<Frame> invalidFrames = engine->frame_list();
    if (invalidFrames.size() != 1 || invalidFrames.first().is_valid_)
        return fail(QStringLiteral("frame shorter than configured Words was accepted"), 13);

    qInfo() << "custom engine smoke test passed";
    return 0;
}
