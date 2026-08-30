#-------------------------------------------------
#
# Project created by QtCreator 2019-03-03T09:58:49
#
#-------------------------------------------------

QT       -= gui

TARGET = justfloat
TEMPLATE = lib
DEFINES += PRINTF_LIBRARY

# The following define makes your compiler emit warnings if you use
# any feature of Qt which has been marked as deprecated (the exact warnings
# depend on your compiler). Please consult the documentation of the
# deprecated API in order to know how to port your code away from it.
DEFINES += QT_DEPRECATED_WARNINGS

# You can also make your code fail to compile if you use deprecated APIs.
# In order to do so, uncomment the following line.
# You can also select to disable deprecated APIs only up to a certain version of Qt.
#DEFINES += QT_DISABLE_DEPRECATED_BEFORE=0x060000    # disables all the APIs deprecated before Qt 6.0.0

SOURCES += \
        justfloat.cpp

HEADERS += \
        justfloat.h \
        ../shared/dataengineinterface.h

INCLUDEPATH += \
    ../shared/

# 部署规则
win32 {
    DESTDIR = $$OUT_PWD
    target.files = $$DESTDIR/$${TARGET}.dll
    target.path = C:/vofa+_publish/plugins/dataengines
    INSTALLS += target
}

macx {
    DESTDIR = $$OUT_PWD/..
    target.files = $$DESTDIR/lib$${TARGET}.1.0.0.dylib
    target.path = /Users/je0000/vofa+_publish/plugins/dataengines
    INSTALLS += target
}

unix:!macx {
    DESTDIR = $$OUT_PWD/..
    target.files = $$DESTDIR/lib$${TARGET}.so.1.0.0
    target.path = /home/je00/vofa+_publish/plugins/dataengines
    INSTALLS += target
}
